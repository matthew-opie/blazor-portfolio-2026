using System.Net.Http.Json;
using System.Text.Json.Serialization;
using blazor_portfolio_2026.Models.Onboarding;

namespace blazor_portfolio_2026.Services;

/// <summary>
/// HTTP client for the onboarding RAG Lambda API.
/// </summary>
public sealed class OnboardingApiClient
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public OnboardingApiClient(HttpClient http, IConfiguration configuration)
    {
        _http = http;
        _baseUrl = configuration["OnboardingApi:BaseUrl"]?.Trim() ?? string.Empty;

        if (IsConfigured)
        {
            _http.BaseAddress = new Uri(_baseUrl.TrimEnd('/') + "/");
        }
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_baseUrl);

    public static string ToBackendTenantId(TenantId tenantId) => TenantIds.ToFolderId(tenantId);

    public async Task VerifyConnectionAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        using var response = await _http.GetAsync("health", cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<HealthPayload>(cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || payload is null || !payload.Success)
        {
            throw new InvalidOperationException(
                payload?.Message ?? $"Onboarding API health check failed ({(int)response.StatusCode}).");
        }
    }

    public async Task<IReadOnlyList<TenantProfile>> GetTenantsAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        using var response = await _http.GetAsync("tenants", cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<TenantsPayload>(cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || payload is null || !payload.Success || payload.Tenants is null)
        {
            throw new InvalidOperationException("Failed to load tenants from onboarding API.");
        }

        return payload.Tenants
            .Select(MapTenant)
            .OrderBy(t => t.Id)
            .ToList();
    }

    public async Task<OnboardingQueryResult> QueryAsync(
        TenantId tenantId,
        string query,
        CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var backendTenantId = ToBackendTenantId(tenantId);
        using var response = await _http.PostAsJsonAsync(
            $"tenants/{backendTenantId}/query",
            new QueryPayload { Query = query },
            cancellationToken);

        var payload = await response.Content.ReadFromJsonAsync<ApiResponsePayload>(cancellationToken: cancellationToken);
        if (payload is null)
        {
            throw new InvalidOperationException("Empty response from onboarding API.");
        }

        if (!response.IsSuccessStatusCode || !payload.Success)
        {
            throw new InvalidOperationException(payload.Message ?? $"Onboarding API returned {(int)response.StatusCode}.");
        }

        return MapResult(payload);
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("OnboardingApi:BaseUrl is not configured in wwwroot/appsettings.json.");
        }
    }

    private static TenantProfile MapTenant(TenantPayload tenant)
    {
        var id = TenantIds.FromFolderId(tenant.TenantId)
                   ?? throw new InvalidOperationException($"Unknown tenant id: {tenant.TenantId}");

        return new TenantProfile(
            id,
            tenant.DisplayId,
            tenant.Name,
            tenant.Name,
            tenant.PartitionKey,
            tenant.VectorCollection);
    }

    private static OnboardingQueryResult MapResult(ApiResponsePayload payload)
    {
        RetrievedChunk? context = null;
        if (payload.Context is not null)
        {
            context = new RetrievedChunk(
                payload.Context.DocumentId,
                payload.Context.SectionTitle,
                payload.Context.Content,
                ParseRetrievalMethod(payload.Context.PrimaryMethod),
                payload.Context.HybridReranked,
                payload.Context.ParentChunkTokenSize,
                payload.Context.RelevanceScore);
        }

        var toolLogs = payload.ToolLogs?
            .Select(log => new McpToolLogEntry(
                log.ToolName,
                log.Parameters,
                log.Output,
                ParseToolStatus(log.Status),
                log.Timestamp,
                log.DurationMs))
            .ToList() ?? [];

        var telemetry = payload.Telemetry is null
            ? new TelemetrySnapshot(0, 0, 0, 0, 0, 0, IsIdle: false)
            : new TelemetrySnapshot(
                payload.Telemetry.VectorSearchP95Ms,
                payload.Telemetry.DynamoDbAssemblyMs,
                payload.Telemetry.HybridRerankMs,
                payload.Telemetry.RagasFaithfulness,
                payload.Telemetry.CrossTenantLeakPercent,
                payload.Telemetry.RetrievedChunks,
                IsIdle: false);

        return new OnboardingQueryResult(payload.Message, context, toolLogs, telemetry);
    }

    private static RetrievalMethod ParseRetrievalMethod(string? value) =>
        string.Equals(value, "DenseVector", StringComparison.OrdinalIgnoreCase)
            ? RetrievalMethod.DenseVector
            : RetrievalMethod.Bm25;

    private static McpLogStatus ParseToolStatus(string? value) => value?.ToLowerInvariant() switch
    {
        "running" => McpLogStatus.Running,
        "error" => McpLogStatus.Error,
        _ => McpLogStatus.Success
    };

    private sealed class HealthPayload
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("message")]
        public string Message { get; set; } = string.Empty;
    }

    private sealed class TenantsPayload
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("tenants")]
        public List<TenantPayload>? Tenants { get; set; }
    }

    private sealed class TenantPayload
    {
        [JsonPropertyName("tenantId")]
        public string TenantId { get; set; } = string.Empty;

        [JsonPropertyName("displayId")]
        public string DisplayId { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("partitionKey")]
        public string PartitionKey { get; set; } = string.Empty;

        [JsonPropertyName("vectorCollection")]
        public string VectorCollection { get; set; } = string.Empty;
    }

    private sealed class QueryPayload
    {
        [JsonPropertyName("query")]
        public string Query { get; set; } = string.Empty;
    }

    private sealed class ApiResponsePayload
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("message")]
        public string Message { get; set; } = string.Empty;

        [JsonPropertyName("toolLogs")]
        public List<ToolLogPayload>? ToolLogs { get; set; }

        [JsonPropertyName("context")]
        public ContextPayload? Context { get; set; }

        [JsonPropertyName("telemetry")]
        public TelemetryPayload? Telemetry { get; set; }
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
    }

    private sealed class TelemetryPayload
    {
        [JsonPropertyName("vectorSearchP95Ms")]
        public double VectorSearchP95Ms { get; set; }

        [JsonPropertyName("dynamoDbAssemblyMs")]
        public double DynamoDbAssemblyMs { get; set; }

        [JsonPropertyName("hybridRerankMs")]
        public double HybridRerankMs { get; set; }

        [JsonPropertyName("ragasFaithfulness")]
        public double RagasFaithfulness { get; set; }

        [JsonPropertyName("crossTenantLeakPercent")]
        public double CrossTenantLeakPercent { get; set; }

        [JsonPropertyName("retrievedChunks")]
        public int RetrievedChunks { get; set; }
    }
}

public sealed record OnboardingQueryResult(
    string Message,
    RetrievedChunk? Context,
    IReadOnlyList<McpToolLogEntry> ToolLogs,
    TelemetrySnapshot Telemetry);
