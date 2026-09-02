using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/employees")]
public class EmployeesController : ControllerBase
{
    private readonly IEmployeeService _employeeService;
    public EmployeesController(IEmployeeService employeeService) => _employeeService = employeeService;

    [HttpGet]
    [RequirePermission(PermissionKeys.EmployeesView)]
    public async Task<ActionResult<IReadOnlyList<EmployeeDto>>> List(bool activeOnly = false) =>
        Ok(await _employeeService.ListAsync(activeOnly));

    [HttpGet("{id:int}")]
    [RequirePermission(PermissionKeys.EmployeesView)]
    public async Task<ActionResult<EmployeeDto>> Get(int id) => Ok(await _employeeService.GetAsync(id));

    [HttpPost]
    [RequirePermission(PermissionKeys.EmployeesCreate)]
    public async Task<ActionResult<EmployeeDto>> Create(CreateEmployeeRequest request) => Ok(await _employeeService.CreateAsync(request));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.EmployeesEdit)]
    public async Task<ActionResult<EmployeeDto>> Update(int id, UpdateEmployeeRequest request) => Ok(await _employeeService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.EmployeesDelete)]
    public async Task<IActionResult> Delete(int id)
    {
        await _employeeService.DeleteAsync(id);
        return NoContent();
    }
}
