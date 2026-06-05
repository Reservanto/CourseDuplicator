using System.Text.Json;
using System.Text.Json.Serialization;
using CourseDuplicator.Models.Reservanto;
using Microsoft.Extensions.Options;

namespace CourseDuplicator.Services;

/// <summary>
/// Typed HttpClient wrapper kolem Reservanto API (https://api.reservanto.cz).
/// STT se předává v hlavičce <c>Authorization: &lt;STT&gt;</c> u všech endpointů kromě GetShortTimeToken.
/// </summary>
public class ReservantoClient
{
    /// <summary>Course/GetList povoluje interval max 31 dní - načítáme po blocích max 30 dnů.</summary>
    private const int MaxIntervalDays = 30;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly ReservantoOptions _options;

    public ReservantoClient(HttpClient http, IOptions<ReservantoOptions> options)
    {
        _http = http;
        _options = options.Value;
        _http.BaseAddress ??= new Uri(_options.ApiBaseUrl);
    }

    /// <summary>Vymění LongTimeToken za ShortTimeToken (platnost cca 30 minut).</summary>
    public async Task<string> GetShortTimeTokenAsync(string longTimeToken, CancellationToken ct = default)
    {
        var body = new ShortTimeTokenRequest(longTimeToken, DateTimeOffset.UtcNow);
        var response = await PostAsync<ShortTimeTokenRequest, ShortTimeTokenResponse>(
            "/v1/Authorize/GetShortTimeToken", body, stt: null, ct);

        if (string.IsNullOrEmpty(response.ShortTimeToken))
            throw new ReservantoApiException(
                $"Reservanto nevrátilo ShortTimeToken: {response.ErrorMessage ?? "bez chybové zprávy"}");

        return response.ShortTimeToken;
    }

    /// <summary>Načte seznam zaměření přihlášeného obchodníka.</summary>
    public async Task<List<Segment>> GetSegmentsAsync(string stt, CancellationToken ct = default)
    {
        var body = new ObjectStateListRequest(OnlyPublic: false, DateTimeOffset.UtcNow);
        var response = await PostAsync<ObjectStateListRequest, ListResponse<Segment>>(
            "/v1/Segment/GetList", body, stt, ct);
        return response.Items ?? [];
    }

    /// <summary>
    /// Načte kurzy segmentu v zadaném období. Course/GetList povoluje interval max 31 dní,
    /// delší období se načítá po blocích max 30 dnů (spec 7.3) s deduplikací podle Id
    /// (kurz překlenující hranici bloků by se vrátil vícekrát).
    /// </summary>
    public async Task<List<SimpleCourse>> GetCourseListAsync(
        string stt, int segmentId, DateTime from, DateTime to, CancellationToken ct = default)
    {
        // Vstupy bereme jako UTC (backend pracuje výhradně v UTC).
        var fromUtc = new DateTimeOffset(DateTime.SpecifyKind(from, DateTimeKind.Utc));
        var toUtc = new DateTimeOffset(DateTime.SpecifyKind(to, DateTimeKind.Utc));

        var coursesById = new Dictionary<int, SimpleCourse>();
        var current = fromUtc;
        while (current <= toUtc)
        {
            var blockEnd = current.AddDays(MaxIntervalDays) < toUtc ? current.AddDays(MaxIntervalDays) : toUtc;

            var body = new CourseGetListRequest(segmentId, current, blockEnd, DateTimeOffset.UtcNow);
            var response = await PostAsync<CourseGetListRequest, ListResponse<SimpleCourse>>(
                "/v1/Course/GetList", body, stt, ct);

            foreach (var course in response.Items ?? [])
                coursesById[course.Id] = course;

            if (blockEnd >= toUtc)
                break;
            // Bloky na sebe navazují přímo (bez denní mezery), překryv hraničního okamžiku řeší dedup.
            current = blockEnd;
        }

        return [.. coursesById.Values];
    }

    /// <summary>Načte detail kurzu včetně jednotlivých lekcí (Appointments).</summary>
    public async Task<CourseDetail> GetCourseAsync(string stt, int courseId, CancellationToken ct = default)
    {
        var body = new CourseSelectRequest(courseId, DateTimeOffset.UtcNow);
        var response = await PostAsync<CourseSelectRequest, ItemResponse<CourseDetail>>(
            "/v1/Course/Get", body, stt, ct);

        return response.Result
            ?? throw new ReservantoApiException($"Course/Get nevrátilo kurz Id={courseId}.");
    }

    /// <summary>Vytvoří nový kurz a vrátí jeho Id.</summary>
    public async Task<int> CreateCourseAsync(string stt, CourseCreateRequest req, CancellationToken ct = default)
    {
        req.TimeStamp = DateTimeOffset.UtcNow;
        var response = await PostAsync<CourseCreateRequest, ItemResponse<CourseDetail>>(
            "/v1/Course/Create", req, stt, ct);

        return response.Result?.Id
            ?? throw new ReservantoApiException($"Course/Create nevrátilo vytvořený kurz pro \"{req.Name}\".");
    }

    private async Task<TResponse> PostAsync<TRequest, TResponse>(
        string path, TRequest body, string? stt, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body, options: JsonOptions),
        };
        // STT není standardní auth schéma ("Bearer xyz"), posílá se jako surová hodnota hlavičky.
        if (stt is not null)
            request.Headers.TryAddWithoutValidation("Authorization", stt);

        using var response = await _http.SendAsync(request, ct);
        var responseBody = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            throw new ReservantoApiException(
                $"Reservanto API vrátilo HTTP {(int)response.StatusCode} pro {path}.",
                response.StatusCode, responseBody);

        var result = JsonSerializer.Deserialize<TResponse>(responseBody, JsonOptions)
            ?? throw new ReservantoApiException($"Prázdná odpověď Reservanto API pro {path}.",
                response.StatusCode, responseBody);

        if (result is ApiResponseBase { IsError: true } error)
            throw new ReservantoApiException(
                $"Reservanto API vrátilo chybu pro {path}: {error.ErrorMessage ?? "bez chybové zprávy"}",
                response.StatusCode, responseBody);

        return result;
    }

    // Request body modely interních endpointů - viz OpenAPI schéma Reservanta.
    private sealed record ShortTimeTokenRequest(
        [property: JsonPropertyName("LongTimeToken")] string LongTimeToken,
        [property: JsonPropertyName("TimeStamp"), JsonConverter(typeof(UnixTimeStampConverter))] DateTimeOffset TimeStamp);

    private sealed record ObjectStateListRequest(
        [property: JsonPropertyName("OnlyPublic")] bool OnlyPublic,
        [property: JsonPropertyName("TimeStamp"), JsonConverter(typeof(UnixTimeStampConverter))] DateTimeOffset TimeStamp);

    private sealed record CourseGetListRequest(
        [property: JsonPropertyName("SegmentId")] int SegmentId,
        [property: JsonPropertyName("IntervalStart"), JsonConverter(typeof(UnixTimeStampConverter))] DateTimeOffset IntervalStart,
        [property: JsonPropertyName("IntervalEnd"), JsonConverter(typeof(UnixTimeStampConverter))] DateTimeOffset IntervalEnd,
        [property: JsonPropertyName("TimeStamp"), JsonConverter(typeof(UnixTimeStampConverter))] DateTimeOffset TimeStamp);

    private sealed record CourseSelectRequest(
        [property: JsonPropertyName("CourseId")] int CourseId,
        [property: JsonPropertyName("TimeStamp"), JsonConverter(typeof(UnixTimeStampConverter))] DateTimeOffset TimeStamp);
}
