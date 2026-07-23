using blazor_portfolio_2026.Models.Onboarding;

namespace blazor_portfolio_2026.Services;

/// <summary>
/// Scoped state container for the live onboarding RAG dashboard.
/// </summary>
public sealed class OnboardingStateService : IDisposable
{
    private static readonly IReadOnlyList<string> SampleQueries =
    [
        "What is the maximum position size limit?",
        "Who is the designated compliance officer?",
        "Is AAPL a restricted ticker?"
    ];

    private static readonly TelemetrySnapshot IdleTelemetry = new(0, 0, 0, 0, 0, 0, IsIdle: true);

    private readonly OnboardingApiClient _apiClient;
    private CancellationTokenSource? _pipelineCts;
    private bool _initialized;

    public IReadOnlyList<TenantProfile> Tenants { get; private set; } = [];

    public TenantProfile? ActiveTenant { get; private set; }

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

    public OnboardingStateService(OnboardingApiClient apiClient) => _apiClient = apiClient;

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
            if (!_apiClient.IsConfigured)
            {
                ConnectionError = "Set OnboardingApi:BaseUrl in wwwroot/appsettings.json.";
                return;
            }

            await _apiClient.VerifyConnectionAsync(cancellationToken);
            Tenants = await _apiClient.GetTenantsAsync(cancellationToken);

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

        Notify();
    }

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

        CancelPipeline();
        _pipelineCts = new CancellationTokenSource();
        var token = _pipelineCts.Token;

        IsProcessing = true;
        StatusMessage = "Calling onboarding API…";
        ToolLogs = [];
        Telemetry = IdleTelemetry;

        var userMessage = new ChatMessage(ChatRole.User, trimmed);
        Messages = Messages.Concat([userMessage]).ToList();
        Notify();

        try
        {
            var assistant = new ChatMessage(ChatRole.Assistant, string.Empty, IsStreaming: true);
            Messages = Messages.Concat([assistant]).ToList();
            Notify();

            var result = await _apiClient.QueryAsync(ActiveTenant.Id, trimmed, token);
            token.ThrowIfCancellationRequested();

            ToolLogs = result.ToolLogs.ToList();
            Notify();

            await StreamResponseAsync(result.Message, token);
            token.ThrowIfCancellationRequested();

            Messages = Messages
                .Take(Messages.Count - 1)
                .Concat([
                    new ChatMessage(
                        ChatRole.Assistant,
                        result.Message,
                        Context: result.Context)
                ])
                .ToList();

            Telemetry = result.Telemetry;
            StatusMessage =
                $"Completed · RAGAS faithfulness {result.Telemetry.RagasFaithfulness:F2} · {result.Telemetry.CrossTenantLeakPercent:F0}% cross-tenant reads";
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
        if (message.Context is null)
        {
            return;
        }

        var updated = message with { ContextExpanded = !message.ContextExpanded };
        Messages = Messages
            .Select((m, i) => i == messageIndex ? updated : m)
            .ToList();

        Notify();
    }

    public void Dispose() => CancelPipeline();

    private async Task StreamResponseAsync(string fullResponse, CancellationToken token)
    {
        var streamed = string.Empty;
        var chunkSize = Math.Max(2, fullResponse.Length / 28);

        for (var i = 0; i < fullResponse.Length; i += chunkSize)
        {
            token.ThrowIfCancellationRequested();

            streamed += fullResponse[i..Math.Min(i + chunkSize, fullResponse.Length)];

            Messages = Messages
                .Take(Messages.Count - 1)
                .Concat([new ChatMessage(ChatRole.Assistant, streamed, IsStreaming: true)])
                .ToList();

            Notify();
            await Task.Delay(45, token);
        }
    }

    private void CancelPipeline()
    {
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
