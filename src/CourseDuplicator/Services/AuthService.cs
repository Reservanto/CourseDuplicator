using System.Text;
using Microsoft.Extensions.Options;

namespace CourseDuplicator.Services;

/// <summary>
/// Autentizace merchanta podle spec 3 (https://api.reservanto.cz/Help-intro/Descriptions/MerchantAuthorization):
/// LTT získaný autorizačním redirectem se drží v session, STT se z něj generuje on-demand
/// a cachuje v session s TTL 25 minut (5min safety margin před 30min platností).
/// CSRF ochranu callbacku řeší session flag "awaiting callback" (Reservanto nepodporuje OAuth state).
/// </summary>
public class AuthService
{
    private const string LttKey = "Auth.LongTimeToken";
    private const string SttKey = "Auth.ShortTimeToken";
    private const string SttExpiresKey = "Auth.ShortTimeTokenExpiresAt";
    private const string AwaitingCallbackKey = "Auth.AwaitingCallbackUntil";

    private static readonly TimeSpan SttTtl = TimeSpan.FromMinutes(25);
    private static readonly TimeSpan AwaitingCallbackTtl = TimeSpan.FromMinutes(10);

    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ReservantoClient _reservanto;
    private readonly ReservantoOptions _options;
    private readonly ILogger<AuthService> _logger;

    public AuthService(
        IHttpContextAccessor httpContextAccessor,
        ReservantoClient reservanto,
        IOptions<ReservantoOptions> options,
        ILogger<AuthService> logger)
    {
        _httpContextAccessor = httpContextAccessor;
        _reservanto = reservanto;
        _options = options.Value;
        _logger = logger;
    }

    private ISession Session =>
        (_httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException("AuthService vyžaduje aktivní HTTP request.")).Session;

    public bool IsAuthenticated => GetLongTimeToken() is not null;

    /// <summary>
    /// Sestaví autorizační URL podle spec 3.3 - parametr <c>rights</c> se opakuje pro každé požadované právo.
    /// </summary>
    public string BuildAuthorizationUrl()
    {
        if (string.IsNullOrWhiteSpace(_options.ClientId))
            throw new InvalidOperationException(
                "Reservanto:ClientId není nakonfigurováno. Doplňte ho přes user-secrets: " +
                "dotnet user-secrets set \"Reservanto:ClientId\" \"<UUID>\"");
        if (string.IsNullOrWhiteSpace(_options.CallbackUrl))
            throw new InvalidOperationException("Reservanto:CallbackUrl není nakonfigurováno.");

        var url = new StringBuilder(_options.ApiBaseUrl.TrimEnd('/'))
            .Append("/v1/Authorize/GetLongTimeToken")
            .Append("?clientId=").Append(Uri.EscapeDataString(_options.ClientId))
            .Append("&redirectUrl=").Append(Uri.EscapeDataString(_options.CallbackUrl));

        foreach (var right in _options.RequestedRights)
            url.Append("&rights=").Append(Uri.EscapeDataString(right));

        return url.ToString();
    }

    /// <summary>Uloží LTT z callbacku do session. LTT je trvalý (až do revokace u Reservanta).</summary>
    public void StoreLongTimeToken(string ltt)
    {
        Session.SetString(LttKey, ltt);
        // Případný STT patřil předchozímu přihlášení.
        Session.Remove(SttKey);
        Session.Remove(SttExpiresKey);
    }

    public string? GetLongTimeToken() => Session.GetString(LttKey);

    /// <summary>
    /// Vrátí platný STT - z session cache, nebo ho transparentně regeneruje z LTT (spec 3.7).
    /// Při selhání regenerace (LTT revokován) smaže LTT ze session a vyhodí <see cref="NotAuthenticatedException"/>.
    /// </summary>
    public async Task<string> GetValidShortTimeTokenAsync(CancellationToken ct = default)
    {
        var ltt = GetLongTimeToken()
            ?? throw new NotAuthenticatedException("Uživatel není přihlášen (v session není LongTimeToken).");

        var cached = Session.GetString(SttKey);
        if (cached is not null && GetUnixSeconds(SttExpiresKey) > DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            return cached;

        string stt;
        try
        {
            stt = await _reservanto.GetShortTimeTokenAsync(ltt, ct);
        }
        catch (ReservantoApiException ex)
        {
            _logger.LogWarning(ex, "Generování STT selhalo - LTT je nejspíš revokovaný, odhlašuji uživatele.");
            Logout();
            throw new NotAuthenticatedException("LongTimeToken přestal platit, je nutné nové přihlášení.", ex);
        }

        Session.SetString(SttKey, stt);
        SetUnixSeconds(SttExpiresKey, DateTimeOffset.UtcNow.Add(SttTtl).ToUnixTimeSeconds());
        return stt;
    }

    /// <summary>Nastaví CSRF flag před přesměrováním na autorizaci Reservanta (spec 3.5, TTL 10 minut).</summary>
    public void MarkAwaitingCallback() =>
        SetUnixSeconds(AwaitingCallbackKey, DateTimeOffset.UtcNow.Add(AwaitingCallbackTtl).ToUnixTimeSeconds());

    /// <summary>Spotřebuje CSRF flag - vrátí true jen pokud byl nastaven a nevypršel. Vždy ho smaže.</summary>
    public bool ConsumeAwaitingCallback()
    {
        var until = GetUnixSeconds(AwaitingCallbackKey);
        Session.Remove(AwaitingCallbackKey);
        return until >= DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    }

    /// <summary>Smaže LTT i STT ze session.</summary>
    public void Logout()
    {
        Session.Remove(LttKey);
        Session.Remove(SttKey);
        Session.Remove(SttExpiresKey);
    }

    private long GetUnixSeconds(string key) =>
        long.TryParse(Session.GetString(key), out var value) ? value : 0;

    private void SetUnixSeconds(string key, long value) =>
        Session.SetString(key, value.ToString());
}
