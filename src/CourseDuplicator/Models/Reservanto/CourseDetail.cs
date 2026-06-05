using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>Detail kurzu z Course/Get (CourseApiModel), včetně jednotlivých lekcí v <see cref="Appointments"/>.</summary>
public class CourseDetail
{
    [JsonPropertyName("Id")]
    public int Id { get; set; }

    [JsonPropertyName("Name")]
    public string? Name { get; set; }

    [JsonPropertyName("Description")]
    public string? Description { get; set; }

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

    [JsonPropertyName("RegistrationEnd")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset RegistrationEnd { get; set; }

    /// <summary>Jednotlivé lekce kurzu.</summary>
    [JsonPropertyName("Appointments")]
    public List<Appointment> Appointments { get; set; } = [];
}
