namespace blazor_portfolio_2026.Models.Onboarding;

/// <summary>Metadata for a policy PDF indexed in a tenant's search corpus.</summary>
public sealed record IndexedDocument(
    string DocumentId,
    string DisplayName,
    string Description,
    string SampleQuery);
