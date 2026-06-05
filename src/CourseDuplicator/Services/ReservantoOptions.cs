namespace CourseDuplicator.Services;

/// <summary>Konfigurace připojení k Reservanto API (sekce "Reservanto" v appsettings / user-secrets).</summary>
public class ReservantoOptions
{
    public const string SectionName = "Reservanto";

    public string ApiBaseUrl { get; set; } = "";
    public string AuthorizeUrl { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string CallbackUrl { get; set; } = "";
}
