using System.Text.Json;
using System.Text.Json.Serialization;
using blazor_portfolio_2026.Models.Onboarding;
using Microsoft.JSInterop;

namespace blazor_portfolio_2026.Services;

/// <summary>
/// Bridges Blazor to the Lambda SSE stream via JS interop (<c>wwwroot/js/onboarding-stream.js</c>).
/// Events: toolLog → token → telemetry → done.
/// </summary>
public sealed class OnboardingStreamClient(IJSRuntime js, IConfiguration configuration)
{
    private readonly string _baseUrl = configuration["OnboardingApi:BaseUrl"]?.Trim().TrimEnd('/') ?? string.Empty;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_baseUrl);

    public Task StreamQueryAsync(
        string tenantId,
        string query,
        DotNetObjectReference<OnboardingStreamHandler> handler,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("OnboardingApi:BaseUrl is not configured.");
        }

        return js.InvokeVoidAsync("onboardingStream.streamQuery", cancellationToken, _baseUrl, tenantId, query, handler)
            .AsTask();
    }
}

public sealed class OnboardingStreamHandler(
    Action<McpToolLogEntry> onToolLog,
    Action<string> onToken,
    Action<IReadOnlyList<RetrievedChunk>> onContexts,
    Action<TelemetrySnapshot> onTelemetry,
    Action onDone,
    Action<string> onError)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    [JSInvokable]
    public Task HandleToolLog(string json)
    {
        var payload = JsonSerializer.Deserialize<ToolLogPayload>(json, JsonOptions);
        if (payload is null)
        {
            return Task.CompletedTask;
        }

        onToolLog(new McpToolLogEntry(
            payload.ToolName,
            payload.Parameters,
            payload.Output,
            ParseToolStatus(payload.Status),
            payload.Timestamp,
            payload.DurationMs));
        return Task.CompletedTask;
    }

    [JSInvokable]
    public Task HandleToken(string text)
    {
        if (!string.IsNullOrEmpty(text))
        {
            onToken(text);
        }

        return Task.CompletedTask;
    }

    [JSInvokable]
    public Task HandleContexts(string json)
    {
        var payload = JsonSerializer.Deserialize<ContextsPayload>(json, JsonOptions);
        if (payload?.Contexts is null)
        {
            return Task.CompletedTask;
        }

        onContexts(payload.Contexts.Select(MapContext).ToList());
        return Task.CompletedTask;
    }

    [JSInvokable]
    public Task HandleTelemetry(string json)
    {
        var payload = JsonSerializer.Deserialize<TelemetryPayload>(json, JsonOptions);
        if (payload is null)
        {
            return Task.CompletedTask;
        }

        onTelemetry(new TelemetrySnapshot(
            payload.EmbeddingMs,
            payload.QdrantSearchMs,
            payload.DynamoDbAssemblyMs,
            payload.ParentAssemblyMs,
            payload.Bm25Ms,
            payload.HybridRerankMs,
            payload.RagasFaithfulness,
            payload.CrossTenantLeakPercent,
            payload.DataPlaneChecks,
            payload.RetrievedChunks,
            payload.ChildChunksCached,
            IsIdle: false));
        return Task.CompletedTask;
    }

    [JSInvokable]
    public Task HandleDone()
    {
        onDone();
        return Task.CompletedTask;
    }

    [JSInvokable]
    public Task HandleError(string message)
    {
        onError(message);
        return Task.CompletedTask;
    }

    private static RetrievedChunk MapContext(ContextPayload context) =>
        new(
            context.DocumentId,
            context.SectionTitle,
            context.Content,
            string.Equals(context.PrimaryMethod, "DenseVector", StringComparison.OrdinalIgnoreCase)
                ? RetrievalMethod.DenseVector
                : RetrievalMethod.Bm25,
            context.HybridReranked,
            context.ParentChunkTokenSize,
            context.RelevanceScore,
            context.Page);

    private static McpLogStatus ParseToolStatus(string? value) => value?.ToLowerInvariant() switch
    {
        "running" => McpLogStatus.Running,
        "error" => McpLogStatus.Error,
        _ => McpLogStatus.Success
    };

    private sealed class ContextsPayload
    {
        [JsonPropertyName("contexts")]
        public List<ContextPayload>? Contexts { get; set; }
    }

    private sealed class ContextPayload
    {
        [JsonPropertyName("documentId")]
        public string DocumentId { get; set; } = string.Empty;

        [JsonPropertyName("sectionTitle")]
        public string SectionTitle { get; set; } = string.Empty;

        [JsonPropertyName("content")]
        public string Content { get; set; } = string.Empty;

        [JsonPropertyName("primaryMethod")]
        public string PrimaryMethod { get; set; } = string.Empty;

        [JsonPropertyName("hybridReranked")]
        public bool HybridReranked { get; set; }

        [JsonPropertyName("parentChunkTokenSize")]
        public int ParentChunkTokenSize { get; set; }

        [JsonPropertyName("relevanceScore")]
        public double RelevanceScore { get; set; }

        [JsonPropertyName("page")]
        public int Page { get; set; }
    }

    private sealed class ToolLogPayload
    {
        [JsonPropertyName("toolName")]
        public string ToolName { get; set; } = string.Empty;

        [JsonPropertyName("parameters")]
        public string Parameters { get; set; } = string.Empty;

        [JsonPropertyName("output")]
        public string Output { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public DateTimeOffset Timestamp { get; set; }

        [JsonPropertyName("durationMs")]
        public int DurationMs { get; set; }
    }

    private sealed class TelemetryPayload
    {
        [JsonPropertyName("embeddingMs")]
        public double EmbeddingMs { get; set; }

        [JsonPropertyName("qdrantSearchMs")]
        public double QdrantSearchMs { get; set; }

        [JsonPropertyName("dynamoDbAssemblyMs")]
        public double DynamoDbAssemblyMs { get; set; }

        [JsonPropertyName("parentAssemblyMs")]
        public double ParentAssemblyMs { get; set; }

        [JsonPropertyName("bm25Ms")]
        public double Bm25Ms { get; set; }

        [JsonPropertyName("hybridRerankMs")]
        public double HybridRerankMs { get; set; }

        [JsonPropertyName("childChunksCached")]
        public bool ChildChunksCached { get; set; }

        [JsonPropertyName("ragasFaithfulness")]
        public double RagasFaithfulness { get; set; }

        [JsonPropertyName("crossTenantLeakPercent")]
        public double CrossTenantLeakPercent { get; set; }

        [JsonPropertyName("dataPlaneChecks")]
        public int DataPlaneChecks { get; set; }

        [JsonPropertyName("retrievedChunks")]
        public int RetrievedChunks { get; set; }
    }
}
