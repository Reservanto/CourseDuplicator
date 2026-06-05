using System.Text.Json;
using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>
/// Reservanto API posílá datumy jako UnixTimeStamp - počet sekund od 1. 1. 1970 0:00:00 UTC (long).
/// Konvertuje long ↔ <see cref="DateTimeOffset"/> v UTC.
/// </summary>
public sealed class UnixTimeStampConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => DateTimeOffset.FromUnixTimeSeconds(reader.GetInt64());

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
        => writer.WriteNumberValue(value.ToUnixTimeSeconds());
}

/// <summary>Varianta pro UnixTimeStampNullable (nullable long ↔ nullable DateTimeOffset).</summary>
public sealed class NullableUnixTimeStampConverter : JsonConverter<DateTimeOffset?>
{
    public override DateTimeOffset? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => reader.TokenType == JsonTokenType.Null ? null : DateTimeOffset.FromUnixTimeSeconds(reader.GetInt64());

    public override void Write(Utf8JsonWriter writer, DateTimeOffset? value, JsonSerializerOptions options)
    {
        if (value is null)
            writer.WriteNullValue();
        else
            writer.WriteNumberValue(value.Value.ToUnixTimeSeconds());
    }
}
