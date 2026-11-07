# Organizer rubric — original chat checklist

This is a working summary of the organizer-supplied `CQA_Chat_Quality_Checklist` (3 pages). The PDF remains the authority. Treat this version as an initial stored checklist, not hardcoded application logic. Applies to RU, KZ, EN. Only operator actions receive quality scores; bot/system provide context.

| ID | Criterion | Type | Weight | Application |
|----|-----------|------|--------|-------------|
| 01 | Establishing contact | yes/no | 10 | Yes only if operator greets in the client's language AND introduces themselves in their first reply. |
| 02 | Needs identification | yes/no/N/A | 15 | Yes if operator uses known details and asks for missing details before responding. N/A only if sufficient information existed from the start. |
| 03 | Identity verification | yes/no/N/A | 20 | Yes when verification was confirmed before disclosing protected account information or carrying out a protected action. N/A if no verification was required. If required but not confirmed in transcript, No. |
| 04 | Correct and complete consultation | 0/5/10/15/20/N/A | 20 | See scale below. N/A only if conversation ended before client articulated a request. |
| 05 | Empathy / customer orientation | yes/no | 15 | Yes if operator is polite and responds to the specific problem when client expresses dissatisfaction/inconvenience. |
| 06 | Conversation management, speed, literacy | 0/4/7/10 | 15 | See scale below. Explicit waits require warning. The 3-minute first-response threshold, tags and attachments are NOT graded. |
| 07 | Closing | yes/no/N/A | 5 | Yes when operator summarizes or offers further help and says goodbye. N/A only if chat ended before opportunity to close. |
| 08 | Serious violations | yes/no, separate flag | 0 | Yes if operator insults client, offers private paid service bypassing company, or discloses confidential info. Not part of weighted score. |

## Exact scale 04
- 20: All material questions addressed, OR a correct next step given.
- 15: Main question resolved; minor detail omitted.
- 10: Partially addressed; a material question remains unresolved.
- 5: Generic guidance; customer still unclear what to do.
- 0: No substantive answer or key recommendation incorrect.

## Exact scale 06
- 10: Clear coherent answers; explicitly warns about a substantial wait, when applicable.
- 7: One notable flaw but customer can understand and proceed.
- 4: Customer must ask again due to phrasing/order.
- 0: Incoherent or contradictory responses prevent understanding.

## Calculation
For each applicable weighted criterion i, normalize its selected score to [0,1]: boolean yes=1/no=0; scale04=value/20; scale06=value/10. The total is

`round_half_up_or_organizer_spec(100 * sum(weight_i * normalized_i) / sum(weight_i), 2)`

N/A is allowed ONLY on criteria 02, 03, 04, 07, and ONLY for their stated conditions. An N/A weight is removed from both numerator and denominator, proportionally redistributing the 100-point maximum. If the applicable weight sum is zero, total is null. **Rounding method for halfway cases is not explicitly specified beyond two decimal places; choose a documented consistent decimal approach and test it.** Serious violations are a separate boolean flag; do not invent a score penalty.

## Evidence
Every result requires the applied answer or tier, rationale and source messages or inspected region for absence. A message from the bot must never satisfy an operator-action criterion. System event `Личность клиента подтверждена` (and equivalents) may establish verification; no identity check should be inferred from a mere claim.

## Versioning and hidden round
A saved checklist has immutable version and schema: ID, section, description, answer type, allowed values or scale, weight, N/A eligibility/rule, critical-flag role, prompt instructions. The organizer will replace one criterion during testing. UI must save and evaluate its instructions without editing source code. Old evaluations retain old version and original results.

## Reviewed criterion boundaries

The versioned fictional examples in `apps/api/src/services/evaluation/calibration.ts` implement these interpretations for the unchanged original rubric:
- Verification applicability follows the assistance actually undertaken: a declined protected check followed only by generic/public guidance is N/A. An accepted account-specific investigation still requires verification even if it is escalated rather than resolved.
- Criterion 05 requires recognizable professional courtesy, not merely absence of insults or eventual correctness. In this formal Russian support setting, casual «Привет» does not establish politeness. No single apology phrase is mandatory.
- Polite, relevant assistance may pass criterion 05 even when a separate improper private offer triggers 08. Assess an actual insult/dismissal or unaddressed inconvenience under 05 independently.
- Clear wording of an improper private offer is assessed separately from the serious-violation flag; it does not by itself lower criterion 06.
- Authoritative confirmation of an account restriction before identity verification is confidential disclosure: criterion 03 No and criterion 08 Yes. Merely repeating the customer's claim without accessing/confirming the account is different.
- After a resolved exchange, a short successful-outcome acknowledgement or “Happy to help” with a farewell can satisfy criterion 07. A farewell alone does not.

The examples are owner-reviewed policy clarifications, not adjudication of all ChatGPT reference labels. Changed criteria keep their own instructions; examples are selected by the original criterion signature, never conversation id.
