namespace CourseDuplicator.Services;

/// <summary>
/// Konfigurace připojení k Reservanto API (sekce "Reservanto" v appsettings / user-secrets).
/// Žádný ClientSecret - Reservanto ho nepoužívá, bezpečnost zajišťuje registrace CallbackUrl (spec 3.6).
/// </summary>
public class ReservantoOptions
{
    public const string SectionName = "Reservanto";

    public string ApiBaseUrl { get; set; } = "";

    /// <summary>UUID získané registrací aplikace u Reservanta. Doplnit přes user-secrets.</summary>
    public string ClientId { get; set; } = "";

    /// <summary>Callback URL zaregistrovaná u Reservanta (např. https://localhost:5001/Auth/Callback).</summary>
    public string CallbackUrl { get; set; } = "";

    /// <summary>Práva požadovaná při autorizaci - v autorizační URL se opakují jako &amp;rights=X&amp;rights=Y.</summary>
    public string[] RequestedRights { get; set; } = [];

    /// <summary>
    /// Názvy povinných nastavení (bez prefixu sekce), která chybí - bez nich nelze sestavit autorizační URL.
    /// Prázdný seznam = konfigurace pro přihlášení je kompletní.
    /// </summary>
    public IReadOnlyList<string> GetMissingLoginSettings()
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(ClientId)) missing.Add(nameof(ClientId));
        if (string.IsNullOrWhiteSpace(CallbackUrl)) missing.Add(nameof(CallbackUrl));
        return missing;
    }
}
