namespace blazor_portfolio_2026.Models.Onboarding;

/// <summary>Maps dashboard tenant enum values to backend/S3 identifiers.</summary>
public static class TenantIds
{
    public static int ToNumber(TenantId tenantId) => (int)tenantId + 1;

    public static string ToFolderId(TenantId tenantId) => $"tenant_{ToNumber(tenantId):D3}";

    public static string ToDisplayId(TenantId tenantId) => $"Tenant_{ToNumber(tenantId):D3}";

    public static string ToPartitionKey(TenantId tenantId) => $"TENANT#{ToNumber(tenantId):D3}";

    public static TenantId? FromFolderId(string folderId)
    {
        if (!folderId.StartsWith("tenant_", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!int.TryParse(folderId.AsSpan(7), out var number) || number is < 1 or > 10)
        {
            return null;
        }

        return (TenantId)(number - 1);
    }
}
