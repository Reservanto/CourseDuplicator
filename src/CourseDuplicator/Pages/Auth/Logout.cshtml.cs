using CourseDuplicator.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CourseDuplicator.Pages.Auth;

public class LogoutModel : PageModel
{
    private readonly AuthService _authService;

    public LogoutModel(AuthService authService)
    {
        _authService = authService;
    }

    // Odhlášení jen přes POST (antiforgery); GET nemá co zobrazit.
    public IActionResult OnGet() => RedirectToPage("/Auth/Login");

    public IActionResult OnPost()
    {
        _authService.Logout();
        return RedirectToPage("/Auth/Login");
    }
}
