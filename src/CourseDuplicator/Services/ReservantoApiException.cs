using System.Net;

namespace CourseDuplicator.Services;

/// <summary>Chyba při komunikaci s Reservanto API - HTTP 4xx/5xx, nebo IsError v těle odpovědi.</summary>
public class ReservantoApiException : Exception
{
    /// <summary>HTTP status odpovědi. Null, pokud chyba nevznikla na HTTP úrovni.</summary>
    public HttpStatusCode? StatusCode { get; }

    /// <summary>Surové tělo response pro diagnostiku.</summary>
    public string? ResponseBody { get; }

    public ReservantoApiException(string message, HttpStatusCode? statusCode = null, string? responseBody = null)
        : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
