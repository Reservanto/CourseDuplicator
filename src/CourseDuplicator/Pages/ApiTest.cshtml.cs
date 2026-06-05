using System.Text.Encodings.Web;
using System.Text.Json;
using CourseDuplicator.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CourseDuplicator.Pages;

/// <summary>Testovací stránka pro ruční ověření auth flow a API klienta (LTT → STT → Segment/GetList).</summary>
public class ApiTestModel : PageModel
{
    private static readonly JsonSerializerOptions PrettyJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly ReservantoClient _reservanto;
    private readonly ILogger<ApiTestModel> _logger;

    public ApiTestModel(ReservantoClient reservanto, ILogger<ApiTestModel> logger)
    {
        _reservanto = reservanto;
        _logger = logger;
    }

    [BindProperty]
    public string? LongTimeToken { get; set; }

    public string? ResultJson { get; private set; }
    public string? Error { get; private set; }

    public void OnGet()
    {
    }

    public async Task OnPostTestAsync(CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(LongTimeToken))
        {
            Error = "Zadejte LongTimeToken.";
            return;
        }

        try
        {
            var stt = await _reservanto.GetShortTimeTokenAsync(LongTimeToken.Trim(), ct);
            var segments = await _reservanto.GetSegmentsAsync(stt, ct);
            ResultJson = JsonSerializer.Serialize(segments, PrettyJson);
            _logger.LogInformation("Test API: načteno {SegmentCount} segmentů.", segments.Count);
        }
        catch (ReservantoApiException ex)
        {
            _logger.LogError(ex, "Test API selhal: {StatusCode} {ResponseBody}", ex.StatusCode, ex.ResponseBody);
            Error = ex.ResponseBody is null ? ex.Message : $"{ex.Message}\n\n{ex.ResponseBody}";
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Test API selhal na síťové úrovni.");
            Error = $"Síťová chyba: {ex.Message}";
        }
    }
}
