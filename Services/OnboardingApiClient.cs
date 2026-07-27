using System.Net.Http.Json;
using System.Text.Json.Serialization;
using blazor_portfolio_2026.Models.Onboarding;

namespace blazor_portfolio_2026.Services;

/// <summary>
/// HTTP client for the onboarding RAG Lambda API.
/// </summary>
public sealed class OnboardingApiClient(HttpClient http, IConfiguration configuration)
{
    private readonly string _baseUrl = ConfigureBaseUrl(configuration);

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_baseUrl);

    public static string ToBackendTenantId(TenantId tenantId) => TenantIds.ToFolderId(tenantId);

    public async Task VerifyConnectionAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        using var response = await http.GetAsync("health", cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<HealthPayload>(cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || payload is null || !payload.Success)
        {
            throw new InvalidOperationException(
                payload?.Message ?? $"Onboarding API health check failed ({(int)response.StatusCode}).");
        }
    }

    /// <summary>Best-effort warm-up — primes Lambda container, child chunk cache, and Qdrant.</summary>
    public async Task WarmAsync(CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
        {
            return;
        }

        try
        {
            using var response = await http.GetAsync("warm", cancellationToken);
            _ = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        }
        catch
        {
            // Warm is invisible to users when it fails.
        }
    }

    public async Task<IReadOnlyList<TenantProfile>> GetTenantsAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        using var response = await http.GetAsync("tenants", cancellationToken);
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
        using var response = await http.PostAsJsonAsync(
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

    public async Task<IngestStatusSnapshot> GetIngestStatusAsync(
        TenantId tenantId,
        CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var backendTenantId = ToBackendTenantId(tenantId);
        using var response = await http.GetAsync($"tenants/{backendTenantId}/ingest-status", cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<IngestStatusPayload>(cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || payload is null || !payload.Success)
        {
            throw new InvalidOperationException(
                payload?.Error ?? $"Failed to load ingest status ({(int)response.StatusCode}).");
        }

        return new IngestStatusSnapshot(
            payload.Status ?? "unknown",
            payload.StartedAt,
            payload.CompletedAt,
            payload.PdfCount,
            payload.ChunkCount,
            payload.Error);
    }

    public async Task<EvalStatusSnapshot> GetEvalStatusAsync(
        TenantId tenantId,
        CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var backendTenantId = ToBackendTenantId(tenantId);
        using var response = await http.GetAsync($"tenants/{backendTenantId}/eval", cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<EvalStatusPayload>(cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || payload is null || !payload.Success)
        {
            throw new InvalidOperationException(
                payload?.Error ?? $"Failed to load eval status ({(int)response.StatusCode}).");
        }

        return new EvalStatusSnapshot(
            payload.Status ?? "unknown",
            payload.Faithfulness,
            payload.LastEvalRunAt,
            payload.QuestionCount,
            payload.Error);
    }

    public async Task<IReadOnlyList<IndexedDocument>> GetDocumentsAsync(
        TenantId tenantId,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
        {
            return TenantDocumentCatalog.GetDocuments(tenantId);
        }

        try
        {
            var backendTenantId = ToBackendTenantId(tenantId);
            using var response = await http.GetAsync($"tenants/{backendTenantId}/documents", cancellationToken);
            var payload = await response.Content.ReadFromJsonAsync<DocumentsPayload>(cancellationToken: cancellationToken);

            if (!response.IsSuccessStatusCode || payload is null || !payload.Success || payload.Documents is null)
            {
                return TenantDocumentCatalog.GetDocuments(tenantId);
            }

            var catalog = TenantDocumentCatalog.GetDocuments(tenantId)
                .ToDictionary(d => d.DocumentId, StringComparer.OrdinalIgnoreCase);

            return payload.Documents
                .Select(doc =>
                {
                    catalog.TryGetValue(doc.DocumentId, out var known);
                    return new IndexedDocument(
                        doc.DocumentId,
                        doc.DisplayName ?? known?.DisplayName ?? doc.DocumentId,
                        known?.Description ?? doc.SectionTitle ?? doc.DisplayName ?? doc.DocumentId,
                        known?.SampleQuery ?? string.Empty);
                })
                .OrderBy(d => d.DocumentId, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch
        {
            return TenantDocumentCatalog.GetDocuments(tenantId);
        }
    }

    public string GetDocumentPdfUrl(TenantId tenantId, string documentId, int page = 0)
    {
        EnsureConfigured();

        var backendTenantId = ToBackendTenantId(tenantId);
        var url = $"{_baseUrl.TrimEnd('/')}/tenants/{backendTenantId}/documents/{Uri.EscapeDataString(documentId)}/pdf";
        return page > 0 ? $"{url}#page={page}" : url;
    }

    private static string ConfigureBaseUrl(IConfiguration configuration) =>
        configuration["OnboardingApi:BaseUrl"]?.Trim() ?? string.Empty;

    private void EnsureConfigured()
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("OnboardingApi:BaseUrl is not configured. Copy .env.example to .env, set ONBOARDING_API_BASE_URL, then rebuild.");
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
        var contexts = payload.Contexts?.Select(MapContext).ToList() ?? [];
        if (contexts.Count == 0 && payload.Context is not null)
        {
            contexts = [MapContext(payload.Context)];
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
            ? new TelemetrySnapshot(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, IsIdle: false)
            : new TelemetrySnapshot(
                payload.Telemetry.EmbeddingMs,
                payload.Telemetry.QdrantSearchMs,
                payload.Telemetry.DynamoDbAssemblyMs,
                payload.Telemetry.ParentAssemblyMs,
                payload.Telemetry.Bm25Ms,
                payload.Telemetry.HybridRerankMs,
                payload.Telemetry.RagasFaithfulness,
                payload.Telemetry.CrossTenantLeakPercent,
                payload.Telemetry.DataPlaneChecks,
                payload.Telemetry.RetrievedChunks,
                payload.Telemetry.ChildChunksCached,
                IsIdle: false);

        return new OnboardingQueryResult(payload.Message, contexts, toolLogs, telemetry);
    }

    private static RetrievedChunk MapContext(ContextPayload context) =>
        new(
            context.DocumentId,
            context.SectionTitle,
            context.Content,
            ParseRetrievalMethod(context.PrimaryMethod),
            context.HybridReranked,
            context.ParentChunkTokenSize,
            context.RelevanceScore,
            context.Page);

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

    private sealed class EvalStatusPayload
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("status")]
        public string? Status { get; set; }

        [JsonPropertyName("faithfulness")]
        public double? Faithfulness { get; set; }

        [JsonPropertyName("lastEvalRunAt")]
        public DateTimeOffset? LastEvalRunAt { get; set; }

        [JsonPropertyName("questionCount")]
        public int? QuestionCount { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }
    }

    private sealed class DocumentsPayload
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("documents")]
        public List<DocumentPayload>? Documents { get; set; }
    }

    private sealed class DocumentPayload
    {
        [JsonPropertyName("documentId")]
        public string DocumentId { get; set; } = string.Empty;

        [JsonPropertyName("displayName")]
        public string? DisplayName { get; set; }

        [JsonPropertyName("sectionTitle")]
        public string? SectionTitle { get; set; }

        [JsonPropertyName("pdfUrl")]
        public string? PdfUrl { get; set; }
    }

    private sealed class IngestStatusPayload
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("status")]
        public string? Status { get; set; }

        [JsonPropertyName("startedAt")]
        public DateTimeOffset? StartedAt { get; set; }

        [JsonPropertyName("completedAt")]
        public DateTimeOffset? CompletedAt { get; set; }

        [JsonPropertyName("pdfCount")]
        public int? PdfCount { get; set; }

        [JsonPropertyName("chunkCount")]
        public int? ChunkCount { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }
    }

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

        [JsonPropertyName("contexts")]
        public List<ContextPayload>? Contexts { get; set; }

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

        [JsonPropertyName("page")]
        public int Page { get; set; }
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

public sealed record OnboardingQueryResult(
    string Message,
    IReadOnlyList<RetrievedChunk> Contexts,
    IReadOnlyList<McpToolLogEntry> ToolLogs,
    TelemetrySnapshot Telemetry);
