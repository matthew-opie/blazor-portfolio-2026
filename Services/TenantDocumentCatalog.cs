using blazor_portfolio_2026.Models.Onboarding;

namespace blazor_portfolio_2026.Services;

/// <summary>Known indexed PDF templates — one set per tenant, with tenant-specific values.</summary>
public static class TenantDocumentCatalog
{
    private static readonly IReadOnlyList<(string Suffix, string Name, string Description, string SampleQuery)> Templates =
    [
        (
            "01_IMA_Agreement",
            "Investment Management Agreement (IMA)",
            "Core IPS terms: position limits, asset allocation bands, compliance officer designation, and reporting obligations.",
            "What is the maximum position size limit?"),
        (
            "02_KYC_Questionnaire",
            "KYC Questionnaire",
            "Know-your-customer profile: entity type, AUM, beneficial owners, and regulatory status.",
            "Who is the designated compliance officer?"),
        (
            "03_Side_Letter_Exclusions",
            "Side Letter — Restricted Securities",
            "Client-specific ticker exclusions and restricted securities negotiated outside the standard IPS.",
            "Is AAPL a restricted ticker?")
    ];

    public static IReadOnlyList<IndexedDocument> GetDocuments(TenantId tenantId)
    {
        var folderId = TenantIds.ToFolderId(tenantId);
        return Templates
            .Select(t => new IndexedDocument(
                $"{folderId}_{t.Suffix}",
                t.Name,
                t.Description,
                t.SampleQuery))
            .ToList();
    }
}
