import { bus } from '../../lib/events';
import { BeneficiariesService } from './beneficiaries.service';

export function registerBeneficiaries() {
  bus.on('bill.succeeded', ({ transactionId }) => BeneficiariesService.saveFromBill(transactionId));
}
