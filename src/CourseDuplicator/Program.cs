using CourseDuplicator.Filters;
using CourseDuplicator.Services;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages(options =>
{
    // Přihlášení se vyžaduje globálně; výjimky (/Auth/*, /Error) řeší filtr sám.
    options.Conventions.ConfigureFilter(new RequireAuthAttribute());
});

builder.Services.Configure<ReservantoOptions>(
    builder.Configuration.GetSection(ReservantoOptions.SectionName));

builder.Services.AddHttpClient<ReservantoClient>((sp, http) =>
{
    var options = sp.GetRequiredService<IOptions<ReservantoOptions>>().Value;
    http.BaseAddress = new Uri(options.ApiBaseUrl);
});

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<AuthService>();

// Session: in-memory store, drží LTT + cachovaný STT (aplikace je jinak stateless).
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromHours(8);
    options.Cookie.Name = ".CourseDuplicator.Session";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
});

var app = builder.Build();

// Chybějící ClientId/CallbackUrl aplikaci neshodí - Login místo tlačítka zobrazí návod.
// Varování při startu ale upozorní správce ještě před prvním pokusem o přihlášení.
var missingLoginSettings = app.Services.GetRequiredService<IOptions<ReservantoOptions>>().Value.GetMissingLoginSettings();
if (missingLoginSettings.Count > 0)
{
    app.Logger.LogWarning(
        "Chybí konfigurace Reservanto ({MissingSettings}) - přihlášení nebude fungovat, dokud se nedoplní.",
        string.Join(", ", missingLoginSettings));
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

// LTT chodí v query stringu callbacku (návrh Reservanta) - no-referrer brání jeho úniku
// přes hlavičku Referer při navigaci pryč z /Auth/Callback.
app.Use(async (context, next) =>
{
    context.Response.Headers.Append("Referrer-Policy", "no-referrer");
    await next();
});

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseSession();
app.MapRazorPages();

app.Run();
