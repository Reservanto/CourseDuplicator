using CourseDuplicator.Services;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages();

builder.Services.Configure<ReservantoOptions>(
    builder.Configuration.GetSection(ReservantoOptions.SectionName));

builder.Services.AddHttpClient<ReservantoClient>((sp, http) =>
{
    var options = sp.GetRequiredService<IOptions<ReservantoOptions>>().Value;
    http.BaseAddress = new Uri(options.ApiBaseUrl);
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
app.MapRazorPages();

app.Run();
