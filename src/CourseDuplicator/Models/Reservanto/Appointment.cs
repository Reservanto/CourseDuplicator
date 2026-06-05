using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>Jedna lekce kurzu (AppointmentClassApiModel z Reservanto API).</summary>
public class Appointment
{
    [JsonPropertyName("Id")]
    public int Id { get; set; }

    [JsonPropertyName("CourseId")]
    public int? CourseId { get; set; }

    /// <summary>Id kalendáře - CourseApiModel ho nemá, čte se z první lekce kurzu (viz spec 7.6).</summary>
    [JsonPropertyName("CalendarId")]
    public int CalendarId { get; set; }

    [JsonPropertyName("CalendarName")]
    public string? CalendarName { get; set; }

    [JsonPropertyName("Capacity")]
    public int Capacity { get; set; }

    [JsonPropertyName("OccupiedCapacity")]
    public int OccupiedCapacity { get; set; }

    [JsonPropertyName("StartDate")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset StartDate { get; set; }

    [JsonPropertyName("EndDate")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset EndDate { get; set; }
}
