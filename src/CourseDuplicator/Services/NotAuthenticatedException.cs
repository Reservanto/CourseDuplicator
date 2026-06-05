namespace CourseDuplicator.Services;

/// <summary>Uživatel není přihlášen, nebo LTT přestal platit (revokace u Reservanta) - je nutná nová autorizace.</summary>
public class NotAuthenticatedException : Exception
{
    public NotAuthenticatedException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}
