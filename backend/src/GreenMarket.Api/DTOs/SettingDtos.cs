namespace GreenMarket.Api.DTOs;

public record SettingDto(string Key, string Value, string? Description);

public record UpdateSettingRequest(string Value);
