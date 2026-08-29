namespace GreenMarket.Api.Common;

/// <summary>Base for exceptions that should surface as a specific HTTP status rather than a generic 500.</summary>
public abstract class AppException : Exception
{
    public abstract int StatusCode { get; }
    protected AppException(string message) : base(message) { }
}

public class NotFoundAppException : AppException
{
    public override int StatusCode => 404;
    public NotFoundAppException(string entityName, object id) : base($"{entityName} '{id}' was not found.") { }
}

public class ValidationAppException : AppException
{
    public override int StatusCode => 400;
    public ValidationAppException(string message) : base(message) { }
}

public class ConflictAppException : AppException
{
    public override int StatusCode => 409;
    public ConflictAppException(string message) : base(message) { }
}

public class UnauthorizedAppException : AppException
{
    public override int StatusCode => 401;
    public UnauthorizedAppException(string message) : base(message) { }
}
