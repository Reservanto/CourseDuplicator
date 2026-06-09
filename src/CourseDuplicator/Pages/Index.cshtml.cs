using System.Net;
using CourseDuplicator.Models.Reservanto;
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
            _logger.LogError(ex, "Načtení zaměření selhalo: {StatusCode} {ResponseBody}", ex.StatusCode, ex.ResponseBody);
            return ApiError("Načtení zaměření z Reservanta selhalo.");
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
            return ApiError("Neplatné zadání: vyberte zaměření a období OD < DO.", StatusCodes.Status400BadRequest);

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
                "Načteno {CourseCount} kurzů ({TotalCount} v blocích před filtrem) zaměření {SegmentId} pro období {From} - {To}.",
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

    /// <summary>Request body POST /?handler=CheckPeriod. From/To jsou UnixTimestamp (UTC sekundy).</summary>
    public record CheckPeriodRequest(int SegmentId, long From, long To);

    /// <summary>
    /// POST /?handler=CheckPeriod - kontrola, zda v cílovém období již existují kurzy.
    /// Na rozdíl od LoadCourses stačí průnik intervalů (kurz přesahující hranici období se počítá taky).
    /// </summary>
    public async Task<IActionResult> OnPostCheckPeriodAsync([FromBody] CheckPeriodRequest request, CancellationToken ct)
    {
        if (request is null || request.SegmentId <= 0 || request.From >= request.To)
            return ApiError("Neplatné zadání kontroly období.", StatusCodes.Status400BadRequest);

        var from = DateTimeOffset.FromUnixTimeSeconds(request.From);
        var to = DateTimeOffset.FromUnixTimeSeconds(request.To);

        try
        {
            var stt = await _authService.GetValidShortTimeTokenAsync(ct);
            var courses = await _reservanto.GetCourseListAsync(
                stt, request.SegmentId, from.UtcDateTime, to.UtcDateTime, ct);

            var overlapping = courses
                .Where(c => c.StartDate <= to && c.EndDate >= from)
                .OrderBy(c => c.StartDate)
                .ToList();

            return new JsonResult(new
            {
                count = overlapping.Count,
                names = overlapping.Take(5).Select(c => c.Name),
            });
        }
        catch (NotAuthenticatedException)
        {
            return Unauthorized();
        }
        catch (ReservantoApiException ex)
        {
            _logger.LogError(ex, "Kontrola období selhala: {StatusCode} {ResponseBody}", ex.StatusCode, ex.ResponseBody);
            return ApiError("Kontrolu kurzů v novém období se nepodařilo provést.");
        }
    }

    /// <summary>Max souběžných volání Course/Create (spec 5F).</summary>
    private const int MaxParallelCourseCreates = 3;

    // Request body POST /?handler=CreateCourses (spec 7.2). Datumy jsou UnixTimestamp (UTC sekundy).
    public record CreateCoursesRequest(CreateGlobalSettings? GlobalSettings, List<CreateCourseItem>? Courses);
    public record CreateGlobalSettings(bool SingleLectionBookingEnabled, long? SingleLectionBookingFrom);
    public record CreateCourseItem(
        string? Name, string? Description, int SegmentId, int BookingResourceId, int? BookingServiceId,
        int Capacity, decimal? PriceWithVat, long RegistrationEnd, int? CalendarId, List<CreateLectionItem>? Lections);
    public record CreateLectionItem(long Start, int LengthMinutes);

    /// <summary>Výsledek vytvoření jednoho kurzu (JSON pro frontend, camelCase).</summary>
    public record CreateCourseResult(string OriginalName, bool Success, int? NewCourseId, string? Error);

    /// <summary>
    /// POST /?handler=CreateCourses - vytvoří kurzy přes Course/Create, max 3 paralelně.
    /// Chyba jednoho kurzu nezastaví ostatní (spec 5F); výsledky se vrací per kurz.
    /// </summary>
    public async Task<IActionResult> OnPostCreateCoursesAsync([FromBody] CreateCoursesRequest request, CancellationToken ct)
    {
        if (request?.Courses is not { Count: > 0 })
            return ApiError("Žádné kurzy k vytvoření.", StatusCodes.Status400BadRequest);

        foreach (var (course, index) in request.Courses.Select((c, i) => (c, i)))
        {
            if (string.IsNullOrWhiteSpace(course.Name))
                return ApiError($"Kurz #{index + 1} nemá název.", StatusCodes.Status400BadRequest);
            if (course.SegmentId <= 0 || course.BookingResourceId <= 0 || course.Capacity <= 0 || course.RegistrationEnd <= 0)
                return ApiError($"Kurz \"{course.Name}\" má neúplná povinná pole.", StatusCodes.Status400BadRequest);
            if (course.Lections is not { Count: > 0 } || course.Lections.Any(l => l.Start <= 0 || l.LengthMinutes <= 0))
                return ApiError($"Kurz \"{course.Name}\" nemá žádnou platnou lekci.", StatusCodes.Status400BadRequest);
        }

        var globalSettings = request.GlobalSettings ?? new CreateGlobalSettings(false, null);

        try
        {
            // STT se sdílí přes celý batch; při expiraci uprostřed ho regeneruje první neúspěšný
            // task (serializovaně přes zámek), ostatní převezmou novou hodnotu.
            var currentStt = await _authService.GetValidShortTimeTokenAsync(ct);
            using var sttLock = new SemaphoreSlim(1, 1);

            async Task<string> RefreshSttAsync(string failedStt)
            {
                await sttLock.WaitAsync(ct);
                try
                {
                    if (currentStt == failedStt)
                    {
                        _authService.InvalidateShortTimeToken();
                        currentStt = await _authService.GetValidShortTimeTokenAsync(ct);
                    }
                    return currentStt;
                }
                finally
                {
                    sttLock.Release();
                }
            }

            using var semaphore = new SemaphoreSlim(MaxParallelCourseCreates);
            var results = await Task.WhenAll(request.Courses.Select(async course =>
            {
                await semaphore.WaitAsync(ct);
                try
                {
                    return await CreateOneCourseAsync(course, globalSettings, () => currentStt, RefreshSttAsync, ct);
                }
                finally
                {
                    semaphore.Release();
                }
            }));

            var successCount = results.Count(r => r.Success);
            _logger.LogInformation(
                "Batch duplikace dokončen: {SuccessCount}/{TotalCount} kurzů vytvořeno úspěšně.",
                successCount, results.Length);

            return new JsonResult(new { results });
        }
        catch (NotAuthenticatedException)
        {
            return Unauthorized();
        }
    }

    private async Task<CreateCourseResult> CreateOneCourseAsync(
        CreateCourseItem course,
        CreateGlobalSettings globalSettings,
        Func<string> getStt,
        Func<string, Task<string>> refreshSttAsync,
        CancellationToken ct)
    {
        var createRequest = new CourseCreateRequest
        {
            Name = course.Name,
            Description = course.Description,
            SegmentId = course.SegmentId,
            BookingResourceId = course.BookingResourceId,
            BookingServiceId = course.BookingServiceId,
            CalendarId = course.CalendarId,
            Capacity = course.Capacity,
            PriceWithVat = course.PriceWithVat,
            RegistrationEnd = DateTimeOffset.FromUnixTimeSeconds(course.RegistrationEnd),
            SingleLectionBookingEnabled = globalSettings.SingleLectionBookingEnabled,
            SingleLectionBookingFrom = globalSettings.SingleLectionBookingFrom is { } from
                ? DateTimeOffset.FromUnixTimeSeconds(from)
                : null,
            Lections = course.Lections!.Select(l => new Lection
            {
                Start = DateTimeOffset.FromUnixTimeSeconds(l.Start),
                LengthMinutes = l.LengthMinutes,
            }).ToList(),
        };

        var stt = getStt();
        var sttRefreshed = false;

        while (true)
        {
            try
            {
                var newCourseId = await _reservanto.CreateCourseAsync(stt, createRequest, ct);
                _logger.LogInformation(
                    "Kurz \"{CourseName}\" zduplikován jako Id={NewCourseId} ({LectionCount} lekcí).",
                    course.Name, newCourseId, createRequest.Lections.Count);
                return new CreateCourseResult(course.Name!, true, newCourseId, null);
            }
            catch (ReservantoApiException ex) when (
                ex.StatusCode == HttpStatusCode.Unauthorized && !sttRefreshed)
            {
                // STT vypršel uprostřed batche: regenerovat a retry once (spec 8).
                sttRefreshed = true;
                stt = await refreshSttAsync(stt);
            }
            catch (ReservantoApiException ex)
            {
                _logger.LogError(ex,
                    "Vytvoření kurzu \"{CourseName}\" selhalo: {StatusCode} {ResponseBody}",
                    course.Name, ex.StatusCode, ex.ResponseBody);
                var error = ex.StatusCode == HttpStatusCode.Forbidden
                    ? "Chybí oprávnění pro vytváření kurzů. Kontaktujte podporu Reservanta."
                    : ex.Message;
                return new CreateCourseResult(course.Name!, false, null, error);
            }
            catch (NotAuthenticatedException)
            {
                return new CreateCourseResult(course.Name!, false, null, "Přihlášení vypršelo - přihlaste se prosím znovu.");
            }
        }
    }

    private static JsonResult ApiError(string message, int statusCode = StatusCodes.Status502BadGateway) =>
        new(new { error = message }) { StatusCode = statusCode };
}
