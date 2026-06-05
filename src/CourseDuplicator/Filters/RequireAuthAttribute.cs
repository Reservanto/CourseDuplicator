using CourseDuplicator.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace CourseDuplicator.Filters;

/// <summary>
/// Vyžaduje přihlášeného merchanta (LTT v session) - jinak redirect na /Auth/Login se zachováním returnUrl.
/// Aplikuje se globálně přes konvence v Program.cs; stránky pod /Auth a /Error jsou vyjmuté.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public class RequireAuthAttribute : Attribute, IAsyncPageFilter
{
    public Task OnPageHandlerSelectionAsync(PageHandlerSelectedContext context) => Task.CompletedTask;

    public async Task OnPageHandlerExecutionAsync(PageHandlerExecutingContext context, PageHandlerExecutionDelegate next)
    {
        var pagePath = context.ActionDescriptor.ViewEnginePath;
        if (pagePath.StartsWith("/Auth/", StringComparison.OrdinalIgnoreCase)
            || pagePath.Equals("/Error", StringComparison.OrdinalIgnoreCase))
        {
            await next();
            return;
        }

        var auth = context.HttpContext.RequestServices.GetRequiredService<AuthService>();
        if (!auth.IsAuthenticated)
        {
            var returnUrl = context.HttpContext.Request.Path + context.HttpContext.Request.QueryString;
            context.Result = new RedirectToPageResult("/Auth/Login", new { returnUrl });
            return;
        }

        await next();
    }
}
