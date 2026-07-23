namespace blazor_portfolio_2026.Models.Onboarding;

/// <summary>Known tenant identifiers — aligned 1:1 with S3 folders tenant_001 … tenant_010.</summary>
public enum TenantId
{
    Tenant001,
    Tenant002,
    Tenant003,
    Tenant004,
    Tenant005,
    Tenant006,
    Tenant007,
    Tenant008,
    Tenant009,
    Tenant010
}

/// <summary>Role of a message in the RAG chat transcript.</summary>
public enum ChatRole
{
    System,
    User,
    Assistant
}

/// <summary>Which leg of the hybrid retriever surfaced a chunk.</summary>
public enum RetrievalMethod
{
    Bm25,
    DenseVector
}

/// <summary>Lifecycle state of an MCP tool invocation in the execution log.</summary>
public enum McpLogStatus
{
    Running,
    Success,
    Error
}

/// <summary>Static profile metadata rendered in the tenant switcher.</summary>
public sealed record TenantProfile(
    TenantId Id,
    string DisplayId,
    string Name,
    string InstitutionType,
    string PartitionKey,
    string VectorCollection);

/// <summary>A single retrieved legal/policy chunk attached to an assistant response.</summary>
public sealed record RetrievedChunk(
    string DocumentId,
    string SectionTitle,
    string Content,
    RetrievalMethod PrimaryMethod,
    bool HybridReranked,
    int ParentChunkTokenSize,
    double RelevanceScore);

/// <summary>One MCP tool call shown in the execution timeline.</summary>
public sealed record McpToolLogEntry(
    string ToolName,
    string Parameters,
    string Output,
    McpLogStatus Status,
    DateTimeOffset Timestamp,
    int DurationMs);

/// <summary>Per-interaction telemetry surfaced in the benchmarking panel.</summary>
public sealed record TelemetrySnapshot(
    double VectorSearchP95Ms,
    double DynamoDbAssemblyMs,
    double HybridRerankMs,
    double RagasFaithfulness,
    double CrossTenantLeakPercent,
    int RetrievedChunks,
    bool IsIdle);

/// <summary>A chat bubble in the query interface.</summary>
public sealed record ChatMessage(
    ChatRole Role,
    string Content,
    bool IsStreaming = false,
    RetrievedChunk? Context = null,
    bool ContextExpanded = false);
