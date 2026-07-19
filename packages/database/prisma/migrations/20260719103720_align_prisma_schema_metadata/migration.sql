-- DropIndex
DROP INDEX "pre_submit_evidence_account_response_validation_id_idx";

-- AlterTable
ALTER TABLE "broker_order_action" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "broker_order_response_evidence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "broker_request_attempt" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "broker_response_validation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cancel_operator_authorization" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "daily_trade_limit" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "daily_trade_reservation" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "execution_risk_evidence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "instrument_catalog" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "instrument_validation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kill_switch_event" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "live_promotion_event" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "manual_order_approval" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "market_calendar_snapshot" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "operational_config" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "operational_config_activation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "operational_config_version" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_cancel_dispatch_claim" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_dispatch_claim" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_ledger" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_non_dispatch_evidence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_pre_auth_non_dispatch_evidence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_state_history" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "order_submission_authorization" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pre_submit_evidence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "price_snapshot" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rebalance_plan" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rebalance_plan_order" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rebalance_plan_version" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rebalance_run" ALTER COLUMN "id" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "operational_config_activation" RENAME CONSTRAINT "operational_config_activation_config_version_id_fkey" TO "operational_config_activation_operational_config_version_i_fkey";

-- RenameForeignKey
ALTER TABLE "order_cancel_dispatch_claim" RENAME CONSTRAINT "order_cancel_dispatch_claim_operator_authorization_id_fkey" TO "order_cancel_dispatch_claim_cancel_operator_authorization__fkey";

-- RenameForeignKey
ALTER TABLE "order_state_history" RENAME CONSTRAINT "order_state_history_pre_auth_non_dispatch_evidence_id_fkey" TO "order_state_history_pre_authorization_non_dispatch_evidenc_fkey";

-- RenameForeignKey
ALTER TABLE "target_instrument" RENAME CONSTRAINT "target_instrument_validation_identity_fkey" TO "target_instrument_validation_id_market_symbol_fkey";

-- RenameIndex
ALTER INDEX "execution_risk_evidence_plan_version_evaluated_at_idx" RENAME TO "execution_risk_evidence_plan_id_plan_version_evaluated_at_idx";

-- RenameIndex
ALTER INDEX "order_cancel_dispatch_claim_plan_version_order_idx" RENAME TO "order_cancel_dispatch_claim_plan_id_plan_version_plan_order_idx";

-- RenameIndex
ALTER INDEX "order_dispatch_claim_plan_version_order_idx" RENAME TO "order_dispatch_claim_plan_id_plan_version_plan_order_id_idx";

-- RenameIndex
ALTER INDEX "order_submission_authorization_plan_version_order_idx" RENAME TO "order_submission_authorization_plan_id_plan_version_plan_or_idx";

-- RenameIndex
ALTER INDEX "raw_broker_response_collection_run_operation_ordinal_key" RENAME TO "raw_broker_response_collection_run_id_operation_id_ordinal_key";

-- RenameIndex
ALTER INDEX "snapshot_check_snapshot_rule_subject_key" RENAME TO "snapshot_check_snapshot_id_rule_code_subject_key_key";
