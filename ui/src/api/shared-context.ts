import type { SharedContextPublication, SharedContextPublicationStatus } from "@paperclipai/shared";
import { api } from "./client";

export const sharedContextApi = {
  updateStatus: (companyId: string, publicationId: string, status: SharedContextPublicationStatus) =>
    api.patch<SharedContextPublication>(`/companies/${companyId}/shared-context/${publicationId}`, { status }),
};
