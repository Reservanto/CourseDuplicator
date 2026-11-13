using CourseDuplicator.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CourseDuplicator.Pages.Auth;

public class LoginModel : PageModel
{
    /// <summary>Session klíč pro returnUrl přežívající roundtrip přes autorizaci Reservanta.</summary>
    public const string ReturnUrlSessionKey = "Auth.ReturnUrl";

    private readonly AuthService _authService;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<LoginModel> _logger;

    public LoginModel(AuthService authService, IWebHostEnvironment environment, ILogger<LoginModel> logger)
    {
        _authService = authService;
        _environment = environment;
        _logger = logger;
    }

    [BindProperty(SupportsGet = true)]
    public string? ReturnUrl { get; set; }

    /// <summary>Chybějící nastavení (ClientId, CallbackUrl) - pokud není prázdné, přihlášení nelze spustit.</summary>
    public IReadOnlyList<string> MissingSettings { get; private set; } = [];

    /// <summary>V Development ukazujeme návod přes user-secrets, jinde přes proměnné prostředí / App settings.</summary>
    public bool IsDevelopment => _environment.IsDevelopment();

    public void OnGet()
    {
        MissingSettings = _authService.MissingLoginSettings;
    }

    public IActionResult OnPostStart()
    {
        MissingSettings = _authService.MissingLoginSettings;
        if (MissingSettings.Count > 0)
        {
            // Místo neošetřené výjimky zobrazíme stránku s vysvětlením a návodem pro správce.
            _logger.LogError(
                "Přihlášení nelze spustit, chybí konfigurace Reservanto: {MissingSettings}",
                string.Join(", ", MissingSettings));
            return Page();
        }

        // returnUrl musí přežít redirect na Reservanto a zpět - query parametr by se ztratil
        // (registrovaná callback URL je fixní), proto session.
        if (!string.IsNullOrEmpty(ReturnUrl) && Url.IsLocalUrl(ReturnUrl))
            HttpContext.Session.SetString(ReturnUrlSessionKey, ReturnUrl);
        else
            HttpContext.Session.Remove(ReturnUrlSessionKey);

        _authService.MarkAwaitingCallback();
        return Redirect(_authService.BuildAuthorizationUrl());
    }
}
