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

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseSession();
app.MapRazorPages();

app.Run();
