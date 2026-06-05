using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>Zjednodušený model kurzu z výpisu Course/GetList (SimpleCourseApiModel). Neobsahuje lekce.</summary>
public class SimpleCourse
{
    [JsonPropertyName("Id")]
    public int Id { get; set; }

    [JsonPropertyName("Name")]
    public string? Name { get; set; }

    [JsonPropertyName("BookingResourceId")]
    public int BookingResourceId { get; set; }

    [JsonPropertyName("BookingServiceId")]
    public int? BookingServiceId { get; set; }

    [JsonPropertyName("BookingResourceName")]
    public string? BookingResourceName { get; set; }

    [JsonPropertyName("BookingServiceName")]
    public string? BookingServiceName { get; set; }

    [JsonPropertyName("Capacity")]
    public int Capacity { get; set; }

    [JsonPropertyName("OccupiedCapacity")]
    public int OccupiedCapacity { get; set; }

    [JsonPropertyName("PriceWithVat")]
    public decimal? PriceWithVat { get; set; }

    [JsonPropertyName("StartDate")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset StartDate { get; set; }

    [JsonPropertyName("EndDate")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset EndDate { get; set; }

    /// <summary>Celkový počet lekcí kurzu. Lekce samotné je nutné načíst přes Course/Get.</summary>
    [JsonPropertyName("LectionCount")]
    public int LectionCount { get; set; }
}
