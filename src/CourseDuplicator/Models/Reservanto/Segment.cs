using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>Zaměření obchodníka (SegmentApiModel z Reservanto API).</summary>
public class Segment
{
    [JsonPropertyName("Id")]
    public int Id { get; set; }

    [JsonPropertyName("CustomizedName")]
    public string? CustomizedName { get; set; }

    [JsonPropertyName("InternalName")]
    public string? InternalName { get; set; }

    [JsonPropertyName("LocalizedName")]
    public string? LocalizedName { get; set; }

    [JsonPropertyName("SegmentType")]
    public string? SegmentType { get; set; }

    /// <summary>Název pro zobrazení - obchodníkův vlastní název má přednost před lokalizovaným.</summary>
    [JsonIgnore]
    public string Name => CustomizedName ?? LocalizedName ?? InternalName ?? $"Segment {Id}";
}
