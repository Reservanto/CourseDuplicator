using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>Request body pro POST /v1/Course/Create (CourseCreateRequest z Reservanto API).</summary>
public class CourseCreateRequest
{
    [JsonPropertyName("Name")]
    public string? Name { get; set; }

    [JsonPropertyName("Description")]
    public string? Description { get; set; }

    [JsonPropertyName("SegmentId")]
    public int SegmentId { get; set; }

    [JsonPropertyName("BookingResourceId")]
    public int BookingResourceId { get; set; }

    [JsonPropertyName("BookingServiceId")]
    public int? BookingServiceId { get; set; }

    /// <summary>Null = Reservanto použije výchozí kalendář.</summary>
    [JsonPropertyName("CalendarId")]
    public int? CalendarId { get; set; }

    [JsonPropertyName("Capacity")]
    public int Capacity { get; set; }

    [JsonPropertyName("PriceWithVat")]
    public decimal? PriceWithVat { get; set; }

    [JsonPropertyName("RegistrationEnd")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset RegistrationEnd { get; set; }

    /// <summary>Platné pouze pro zaměření typu Classes.</summary>
    [JsonPropertyName("SingleLectionBookingEnabled")]
    public bool SingleLectionBookingEnabled { get; set; }

    [JsonPropertyName("SingleLectionBookingFrom")]
    [JsonConverter(typeof(NullableUnixTimeStampConverter))]
    public DateTimeOffset? SingleLectionBookingFrom { get; set; }

    [JsonPropertyName("Lections")]
    public List<Lection> Lections { get; set; } = [];

    /// <summary>Aktuální čas požadavku - nastavuje ReservantoClient při odeslání.</summary>
    [JsonPropertyName("TimeStamp")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset TimeStamp { get; set; }
}
