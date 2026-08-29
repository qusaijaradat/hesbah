namespace GreenMarket.Api.DTOs;

public record ItemDto(int Id, string Name);

public record CreateItemRequest(string Name);
public record UpdateItemRequest(string Name);

public class ItemFilterRequest
{
    public string? Search { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 100;
}
