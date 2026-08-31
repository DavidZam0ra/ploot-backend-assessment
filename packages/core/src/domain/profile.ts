/** Un Embajador: la única identidad que publica en este slice del sistema. */
export interface Profile {
  id: string;
  tenantId: string;
  displayName: string;
  providerAccountId: string;
  createdAt: Date;
}
