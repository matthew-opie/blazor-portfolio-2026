using System.Text;
using blazor_portfolio_2026.Models.Onboarding;
using Microsoft.JSInterop;

namespace blazor_portfolio_2026.Services;

/// <summary>
/// Scoped state container for the live onboarding RAG dashboard.
/// </summary>
public sealed class OnboardingStateService(OnboardingApiClient apiClient, OnboardingStreamClient streamClient) : IDisposable
{
    private static readonly IReadOnlyList<string> SampleQueries =
    [
        "What is the maximum position size limit?",
        "Who is the designated compliance officer?",
        "Is AAPL a restricted ticker?"
    ];

    private static readonly TelemetrySnapshot IdleTelemetry = new(0, 0, 0, 0, 0, 0, IsIdle: true);
    private static readonly IngestStatusSnapshot UnknownIngestStatus = new("unknown", null, null, null, null, null);
    private static readonly EvalStatusSnapshot UnknownEvalStatus = new("unknown", null, null, null, null);

    private CancellationTokenSource? _pipelineCts;
    private DotNetObjectReference<OnboardingStreamHandler>? _streamHandlerRef;
    private bool _initialized;
    private readonly object _streamGate = new();
    private string _streamedText = string.Empty;
    private IReadOnlyList<RetrievedChunk>? _streamedContexts;
    private readonly List<McpToolLogEntry> _streamToolLogs = [];

    public IReadOnlyList<TenantProfile> Tenants { get; private set; } = [];

    public TenantProfile? ActiveTenant { get; private set; }

    public IngestStatusSnapshot IngestStatus { get; private set; } = UnknownIngestStatus;

    public EvalStatusSnapshot EvalStatus { get; private set; } = UnknownEvalStatus;

    public IReadOnlyList<ChatMessage> Messages { get; private set; } = [];

    public IReadOnlyList<McpToolLogEntry> ToolLogs { get; private set; } = [];

    public TelemetrySnapshot Telemetry { get; private set; } = IdleTelemetry;

    public bool IsProcessing { get; private set; }

    public bool IsInitializing { get; private set; }

    public bool IsConnected { get; private set; }

    public string? ConnectionError { get; private set; }

    public string? StatusMessage { get; private set; }

    public IReadOnlyList<string> SuggestedQueries => SampleQueries;

    public event Action? OnChange;

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_initialized)
        {
            return;
        }

        IsInitializing = true;
        ConnectionError = null;
        Notify();

        try
        {
            if (!apiClient.IsConfigured)
            {
                ConnectionError = "Set OnboardingApi:BaseUrl in wwwroot/appsettings.json.";
                return;
            }

            await apiClient.VerifyConnectionAsync(cancellationToken);
            Tenants = await apiClient.GetTenantsAsync(cancellationToken);

            if (Tenants.Count == 0)
            {
                ConnectionError = "Onboarding API returned no tenants.";
                return;
            }

            IsConnected = true;
            SwitchTenant(Tenants[0].Id);
        }
        catch (Exception ex)
        {
            ConnectionError = ex.Message;
        }
        finally
        {
            IsInitializing = false;
            _initialized = true;
            Notify();
        }
    }

    public void SwitchTenant(TenantId tenantId)
    {
        if (!IsConnected)
        {
            return;
        }

        var tenant = Tenants.FirstOrDefault(t => t.Id == tenantId);
        if (tenant is null)
        {
            return;
        }

        CancelPipeline();

        ActiveTenant = tenant;
        Messages =
        [
            new ChatMessage(
                ChatRole.System,
                $"Partition {tenant.PartitionKey} loaded · collection `{tenant.VectorCollection}` · hybrid RAG pipeline ready.")
        ];
        ToolLogs = [];
        Telemetry = IdleTelemetry;
        IsProcessing = false;
        StatusMessage = $"Tenant context reset · {tenant.DisplayId} · partition {tenant.PartitionKey} · live API";
        IngestStatus = UnknownIngestStatus;
        EvalStatus = UnknownEvalStatus;

        Notify();
        _ = RefreshIngestStatusAsync();
        _ = RefreshEvalStatusAsync();
    }

    public async Task RefreshEvalStatusAsync(CancellationToken cancellationToken = default)
    {
        if (!IsConnected || ActiveTenant is null)
        {
            return;
        }

        try
        {
            EvalStatus = await apiClient.GetEvalStatusAsync(ActiveTenant.Id, cancellationToken);
        }
        catch
        {
            EvalStatus = UnknownEvalStatus;
        }

        Notify();
    }

    public string FormatEvalHint()
    {
        if (EvalStatus.LastEvalRunAt is null || EvalStatus.Faithfulness is null)
        {
            return "Run POST /admin/eval to seed benchmark score";
        }

        return $"Benchmark run {EvalStatus.LastEvalRunAt.Value:MMM d, yyyy} · {EvalStatus.QuestionCount ?? 0} golden questions";
    }

    public async Task RefreshIngestStatusAsync(CancellationToken cancellationToken = default)
    {
        if (!IsConnected || ActiveTenant is null)
        {
            return;
        }

        try
        {
            IngestStatus = await apiClient.GetIngestStatusAsync(ActiveTenant.Id, cancellationToken);
        }
        catch
        {
            IngestStatus = UnknownIngestStatus;
        }

        Notify();
    }

    public string FormatIngestBadge() => IngestStatus.Status.ToLowerInvariant() switch
    {
        "running" => "Indexing…",
        "failed" => "Ingest failed",
        "completed" when IngestStatus.PdfCount.HasValue && IngestStatus.ChunkCount.HasValue =>
            $"Indexed · {IngestStatus.PdfCount} PDFs · {IngestStatus.ChunkCount} chunks",
        "completed" => "Indexed",
        _ => "Not indexed"
    };

    public async Task SubmitQueryAsync(string query)
    {
        if (!IsConnected || ActiveTenant is null)
        {
            StatusMessage = ConnectionError ?? "Onboarding API is not connected.";
            Notify();
            return;
        }

        var trimmed = query.Trim();
        if (string.IsNullOrWhiteSpace(trimmed) || IsProcessing)
        {
            return;
        }

        if (!streamClient.IsConfigured)
        {
            StatusMessage = "Onboarding stream client is not configured.";
            Notify();
            return;
        }

        CancelPipeline();
        _pipelineCts = new CancellationTokenSource();
        var token = _pipelineCts.Token;

        IsProcessing = true;
        StatusMessage = "Retrieving context and invoking MCP tools…";
        ToolLogs = [];
        Telemetry = IdleTelemetry;
        _streamedText = string.Empty;
        _streamedContexts = null;
        _streamToolLogs.Clear();

        var userMessage = new ChatMessage(ChatRole.User, trimmed);
        Messages = Messages.Concat([userMessage]).ToList();
        Notify();

        var completionSource = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var responseBuilder = new StringBuilder();

        try
        {
            Messages = Messages.Concat([new ChatMessage(ChatRole.Assistant, string.Empty, IsStreaming: true)]).ToList();
            Notify();

            _streamHandlerRef = DotNetObjectReference.Create(new OnboardingStreamHandler(
                toolLog =>
                {
                    lock (_streamGate)
                    {
                        _streamToolLogs.Add(toolLog);
                        ToolLogs = _streamToolLogs.ToList();
                    }

                    StatusMessage = $"MCP · {toolLog.ToolName}";
                    Notify();
                },
                chunk =>
                {
                    lock (_streamGate)
                    {
                        responseBuilder.Append(chunk);
                        _streamedText = responseBuilder.ToString();
                        Messages = Messages
                            .Take(Messages.Count - 1)
                            .Concat([new ChatMessage(ChatRole.Assistant, _streamedText, IsStreaming: true)])
                            .ToList();
                    }

                    StatusMessage = "Streaming answer…";
                    Notify();
                },
                contexts =>
                {
                    lock (_streamGate)
                    {
                        _streamedContexts = contexts;
                    }
                },
                telemetry =>
                {
                    Telemetry = telemetry;
                    Notify();
                },
                () => completionSource.TrySetResult(),
                error => completionSource.TrySetException(new InvalidOperationException(error))));

            await streamClient.StreamQueryAsync(
                OnboardingApiClient.ToBackendTenantId(ActiveTenant.Id),
                trimmed,
                _streamHandlerRef,
                token);

            await completionSource.Task.WaitAsync(token);
            token.ThrowIfCancellationRequested();

            Messages = Messages
                .Take(Messages.Count - 1)
                .Concat([
                    new ChatMessage(
                        ChatRole.Assistant,
                        responseBuilder.ToString(),
                        Contexts: _streamedContexts)
                ])
                .ToList();

            StatusMessage =
                $"Completed · {Telemetry.RetrievedChunks} chunk(s) retrieved · 0% cross-tenant reads";
        }
        catch (OperationCanceledException)
        {
            StatusMessage = "Pipeline cancelled.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Pipeline error: {ex.Message}";
        }
        finally
        {
            _streamHandlerRef?.Dispose();
            _streamHandlerRef = null;
            IsProcessing = false;
            Notify();
        }
    }

    public void ToggleContextExpanded(int messageIndex)
    {
        if (messageIndex < 0 || messageIndex >= Messages.Count)
        {
            return;
        }

        var message = Messages[messageIndex];
        if (message.Contexts is not { Count: > 0 })
        {
            return;
        }

        var updated = message with { ContextExpanded = !message.ContextExpanded };
        Messages = Messages
            .Select((m, i) => i == messageIndex ? updated : m)
            .ToList();

        Notify();
    }

    public void ToggleAdditionalContextsExpanded(int messageIndex)
    {
        if (messageIndex < 0 || messageIndex >= Messages.Count)
        {
            return;
        }

        var message = Messages[messageIndex];
        if (message.Contexts is not { Count: > 1 })
        {
            return;
        }

        var updated = message with { AdditionalContextsExpanded = !message.AdditionalContextsExpanded };
        Messages = Messages
            .Select((m, i) => i == messageIndex ? updated : m)
            .ToList();

        Notify();
    }

    public void Dispose() => CancelPipeline();

    private void CancelPipeline()
    {
        _streamHandlerRef?.Dispose();
        _streamHandlerRef = null;

        if (_pipelineCts is null)
        {
            return;
        }

        _pipelineCts.Cancel();
        _pipelineCts.Dispose();
        _pipelineCts = null;
    }

    private void Notify() => OnChange?.Invoke();
}
