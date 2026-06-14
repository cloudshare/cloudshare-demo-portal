export interface ExamAuthoringMode {
  readonly isEditingDraft: boolean;
  readonly provisioningLocked: boolean;
  readonly tupleChangeHint: string | null;
}

export function getExamAuthoringMode(editingExamId: string | null): ExamAuthoringMode {
  if (!editingExamId) {
    return {
      isEditingDraft: false,
      provisioningLocked: false,
      tupleChangeHint: null,
    };
  }

  return {
    isEditingDraft: true,
    provisioningLocked: true,
    tupleChangeHint:
      "Provisioning fields are locked while editing a draft. Cancel edit to choose a different project, blueprint, policy, or region.",
  };
}
