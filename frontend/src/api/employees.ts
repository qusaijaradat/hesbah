import { apiClient } from "./client";
import type { EmployeeDto } from "../types";

export async function listEmployees(params: { activeOnly?: boolean } = {}) {
  const { data } = await apiClient.get<EmployeeDto[]>("/employees", { params });
  return data;
}

export async function createEmployee(payload: { name: string; phone?: string; notes?: string }) {
  const { data } = await apiClient.post<EmployeeDto>("/employees", payload);
  return data;
}

export async function updateEmployee(id: number, payload: { name: string; phone?: string; notes?: string; isActive: boolean }) {
  const { data } = await apiClient.put<EmployeeDto>(`/employees/${id}`, payload);
  return data;
}

// Only succeeds server-side on an employee with zero expenses/withdrawals attributed — see
// EmployeeService.DeleteAsync's doc comment. Deactivate (isActive: false via updateEmployee)
// instead for an employee with real history.
export async function deleteEmployee(id: number) {
  await apiClient.delete(`/employees/${id}`);
}
