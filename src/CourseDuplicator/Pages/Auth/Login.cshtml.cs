using CourseDuplicator.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CourseDuplicator.Pages.Auth;

public class LoginModel : PageModel
{
    /// <summary>Session klíč pro returnUrl přežívající roundtrip přes autorizaci Reservanta.</summary>
    public const string ReturnUrlSessionKey = "Auth.ReturnUrl";

    private readonly AuthService _authService;

    public LoginModel(AuthService authService)
    {
        _authService = authService;
    }

    [BindProperty(SupportsGet = true)]
    public string? ReturnUrl { get; set; }

    public void OnGet()
    {
    }

    public IActionResult OnPostStart()
    {
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
