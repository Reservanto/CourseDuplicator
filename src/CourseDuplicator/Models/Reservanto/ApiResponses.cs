using System.Text.Json.Serialization;

namespace CourseDuplicator.Models.Reservanto;

/// <summary>Společná chybová pole všech response obálek Reservanto API.</summary>
public abstract class ApiResponseBase
{
    [JsonPropertyName("IsError")]
    public bool IsError { get; set; }

    [JsonPropertyName("ErrorMessage")]
    public string? ErrorMessage { get; set; }

    [JsonPropertyName("ErrorMessages")]
    public List<string>? ErrorMessages { get; set; }

    [JsonPropertyName("ErrorParameter")]
    public string? ErrorParameter { get; set; }

    [JsonPropertyName("ErrorParameters")]
    public List<string>? ErrorParameters { get; set; }
}

/// <summary>Odpověď s kolekcí výsledků (ListResponseOf*).</summary>
public class ListResponse<T> : ApiResponseBase
{
    [JsonPropertyName("Items")]
    public List<T>? Items { get; set; }
}

/// <summary>Odpověď s právě jedním výsledkem (ItemResponseOf*).</summary>
public class ItemResponse<T> : ApiResponseBase
{
    [JsonPropertyName("Result")]
    public T? Result { get; set; }
}

/// <summary>Odpověď POST /v1/Authorize/GetShortTimeToken.</summary>
public class ShortTimeTokenResponse : ApiResponseBase
{
    [JsonPropertyName("ShortTimeToken")]
    public string? ShortTimeToken { get; set; }
}
