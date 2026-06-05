using CourseDuplicator.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CourseDuplicator.Pages;

/// <summary>
/// Hlavní stránka s duplikátorem. JSON handlery pro frontend (spec 7.1) - proxy pattern,
/// STT nikdy neopouští backend.
/// </summary>
public class IndexModel : PageModel
{
    /// <summary>Max souběžných volání Course/Get (spec 7.5).</summary>
    private const int MaxParallelCourseGets = 5;

    private readonly AuthService _authService;
    private readonly ReservantoClient _reservanto;
    private readonly ILogger<IndexModel> _logger;

    public IndexModel(AuthService authService, ReservantoClient reservanto, ILogger<IndexModel> logger)
    {
        _authService = authService;
        _reservanto = reservanto;
        _logger = logger;
    }

    public void OnGet()
    {
    }

    /// <summary>GET /?handler=Segments - seznam segmentů pro dropdown v sekci A.</summary>
    public async Task<IActionResult> OnGetSegmentsAsync(CancellationToken ct)
    {
        try
        {
            var stt = await _authService.GetValidShortTimeTokenAsync(ct);
            var segments = await _reservanto.GetSegmentsAsync(stt, ct);
            return new JsonResult(segments.Select(s => new { id = s.Id, name = s.Name }));
        }
        catch (NotAuthenticatedException)
        {
            return Unauthorized();
        }
        catch (ReservantoApiException ex)
        {
            _logger.LogError(ex, "Načtení segmentů selhalo: {StatusCode} {ResponseBody}", ex.StatusCode, ex.ResponseBody);
            return ApiError("Načtení segmentů z Reservanta selhalo.");
        }
    }

    /// <summary>Request body POST /?handler=LoadCourses. From/To jsou UnixTimestamp (UTC sekundy).</summary>
    public record LoadCoursesRequest(int SegmentId, long From, long To);

    /// <summary>
    /// POST /?handler=LoadCourses - načte kurzy období (Course/GetList po blocích, spec 7.3),
    /// vyfiltruje plně spadající do období (spec 7.4) a pro každý dotáhne lekce přes Course/Get (spec 7.5).
    /// </summary>
    public async Task<IActionResult> OnPostLoadCoursesAsync([FromBody] LoadCoursesRequest request, CancellationToken ct)
    {
        if (request is null || request.SegmentId <= 0 || request.From >= request.To)
            return ApiError("Neplatné zadání: vyberte segment a období OD < DO.", StatusCodes.Status400BadRequest);

        var from = DateTimeOffset.FromUnixTimeSeconds(request.From);
        var to = DateTimeOffset.FromUnixTimeSeconds(request.To);

        try
        {
            var stt = await _authService.GetValidShortTimeTokenAsync(ct);

            var allCourses = await _reservanto.GetCourseListAsync(
                stt, request.SegmentId, from.UtcDateTime, to.UtcDateTime, ct);

            // Klientský filtr (spec 7.4): jen kurzy plně spadající do zadaného období.
            var filtered = allCourses
                .Where(c => c.StartDate >= from && c.EndDate <= to)
                .OrderBy(c => c.StartDate)
                .ToList();

            // Lekce nejsou v SimpleCourseApiModel - per kurz Course/Get, max 5 souběžně (spec 7.5).
            using var semaphore = new SemaphoreSlim(MaxParallelCourseGets);
            var details = await Task.WhenAll(filtered.Select(async course =>
            {
                await semaphore.WaitAsync(ct);
                try
                {
                    return await _reservanto.GetCourseAsync(stt, course.Id, ct);
                }
                finally
                {
                    semaphore.Release();
                }
            }));

            _logger.LogInformation(
                "Načteno {CourseCount} kurzů ({TotalCount} v blocích před filtrem) segmentu {SegmentId} pro období {From} - {To}.",
                details.Length, allCourses.Count, request.SegmentId, from, to);

            return new JsonResult(new
            {
                courses = details.Select(d => new
                {
                    originalId = d.Id,
                    name = d.Name,
                    description = d.Description,
                    bookingResourceId = d.BookingResourceId,
                    bookingResourceName = d.BookingResourceName,
                    bookingServiceId = d.BookingServiceId,
                    bookingServiceName = d.BookingServiceName,
                    capacity = d.Capacity,
                    priceWithVat = d.PriceWithVat,
                    startDate = d.StartDate.ToUnixTimeSeconds(),
                    endDate = d.EndDate.ToUnixTimeSeconds(),
                    registrationEnd = d.RegistrationEnd.ToUnixTimeSeconds(),
                    // CalendarId není v CourseApiModel - čte se z první lekce (spec 7.6), pro fázi vytváření.
                    calendarId = d.Appointments.Count > 0 ? d.Appointments[0].CalendarId : (int?)null,
                    lections = d.Appointments
                        .OrderBy(a => a.StartDate)
                        .Select(a => new
                        {
                            start = a.StartDate.ToUnixTimeSeconds(),
                            end = a.EndDate.ToUnixTimeSeconds(),
                        }),
                }),
            });
        }
        catch (NotAuthenticatedException)
        {
            return Unauthorized();
        }
        catch (ReservantoApiException ex)
        {
            _logger.LogError(ex, "Načtení kurzů selhalo: {StatusCode} {ResponseBody}", ex.StatusCode, ex.ResponseBody);
            return ApiError("Načtení kurzů z Reservanta selhalo. Zkuste to prosím znovu.");
        }
    }

    private static JsonResult ApiError(string message, int statusCode = StatusCodes.Status502BadGateway) =>
        new(new { error = message }) { StatusCode = statusCode };
}
