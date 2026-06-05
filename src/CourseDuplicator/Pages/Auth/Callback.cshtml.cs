using CourseDuplicator.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CourseDuplicator.Pages.Auth;

/// <summary>
/// Callback autorizačního flow Reservanta (spec 3.4): ?accepted=1&amp;token=&lt;LTT&gt; při souhlasu,
/// ?accepted=0&amp;token= při zamítnutí. CSRF ochrana přes session flag (spec 3.5).
/// </summary>
public class CallbackModel : PageModel
{
    private readonly AuthService _authService;
    private readonly ILogger<CallbackModel> _logger;

    public CallbackModel(AuthService authService, ILogger<CallbackModel> logger)
    {
        _authService = authService;
        _logger = logger;
    }

    public bool Denied { get; private set; }
    public string? Error { get; private set; }

    public async Task<IActionResult> OnGetAsync(int accepted, string? token, CancellationToken ct)
    {
        if (!_authService.ConsumeAwaitingCallback())
        {
            _logger.LogWarning("Callback bez platného session flagu - možný CSRF pokus nebo vypršelá session.");
            return BadRequest("Neočekávaný callback");
        }

        if (accepted == 0)
        {
            _logger.LogInformation("Merchant zamítl autorizaci aplikace.");
            Denied = true;
            return Page();
        }

        if (accepted != 1 || string.IsNullOrWhiteSpace(token))
            return BadRequest("Neplatné parametry callbacku");

        _authService.StoreLongTimeToken(token);

        // Sanity check: LTT musí jít vyměnit za STT, jinak je přihlášení k ničemu.
        try
        {
            await _authService.GetValidShortTimeTokenAsync(ct);
        }
        catch (NotAuthenticatedException ex)
        {
            _logger.LogError(ex, "Sanity check LTT selhal - token z callbacku nelze vyměnit za STT.");
            Error = "Získaný token se nepodařilo ověřit u Reservanta. Zkuste se přihlásit znovu.";
            return Page();
        }

        _logger.LogInformation("Merchant úspěšně přihlášen přes Reservanto.");

        var returnUrl = HttpContext.Session.GetString(LoginModel.ReturnUrlSessionKey);
        HttpContext.Session.Remove(LoginModel.ReturnUrlSessionKey);
        return returnUrl is not null && Url.IsLocalUrl(returnUrl)
            ? LocalRedirect(returnUrl)
            : RedirectToPage("/Index");
    }
}
