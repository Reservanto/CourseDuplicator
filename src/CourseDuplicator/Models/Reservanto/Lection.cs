using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>Jedna lekce při vytváření kurzu (CourseLectionCreateRequest z Reservanto API).</summary>
public class Lection
{
    [JsonPropertyName("Name")]
    public string? Name { get; set; }

    [JsonPropertyName("Start")]
    [JsonConverter(typeof(UnixTimeStampConverter))]
    public DateTimeOffset Start { get; set; }

    [JsonPropertyName("LengthMinutes")]
    public int LengthMinutes { get; set; }
}
