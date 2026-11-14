package model

import "testing"

func TestPaymentStatusTransitions(t *testing.T) {
	testCases := []struct {
		name          string
		currentStatus PaymentStatus
		nextStatus    PaymentStatus
		isAllowed     bool
	}{
		{"pending to processing", PaymentStatusPending, PaymentStatusProcessing, true},
		{"pending to cancelled", PaymentStatusPending, PaymentStatusCancelled, true},
		{"processing to succeeded", PaymentStatusProcessing, PaymentStatusSucceeded, true},
		{"processing to failed", PaymentStatusProcessing, PaymentStatusFailed, true},
		{"pending cannot skip to succeeded", PaymentStatusPending, PaymentStatusSucceeded, false},
		{"pending cannot skip to failed", PaymentStatusPending, PaymentStatusFailed, false},
		{"processing cannot be cancelled", PaymentStatusProcessing, PaymentStatusCancelled, false},
		{"succeeded is terminal", PaymentStatusSucceeded, PaymentStatusFailed, false},
		{"failed is terminal", PaymentStatusFailed, PaymentStatusSucceeded, false},
		{"cancelled is terminal", PaymentStatusCancelled, PaymentStatusPending, false},
		{"no self transition", PaymentStatusPending, PaymentStatusPending, false},
		{"unknown status has no transitions", PaymentStatus("refunded"), PaymentStatusPending, false},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := testCase.currentStatus.CanTransitionTo(testCase.nextStatus); got != testCase.isAllowed {
				t.Fatalf("CanTransitionTo(%s -> %s) = %v, want %v",
					testCase.currentStatus, testCase.nextStatus, got, testCase.isAllowed)
			}
		})
	}
}

func TestPaymentStatusIsTerminal(t *testing.T) {
	terminalStatuses := map[PaymentStatus]bool{
		PaymentStatusPending:    false,
		PaymentStatusProcessing: false,
		PaymentStatusSucceeded:  true,
		PaymentStatusFailed:     true,
		PaymentStatusCancelled:  true,
	}
	for status, wantTerminal := range terminalStatuses {
		if status.IsTerminal() != wantTerminal {
			t.Errorf("%s.IsTerminal() = %v, want %v", status, status.IsTerminal(), wantTerminal)
		}
	}
}

func TestPaymentMethodIsValid(t *testing.T) {
	for _, validMethod := range []PaymentMethod{PaymentMethodCard, PaymentMethodBankTransfer, PaymentMethodPromptPay, PaymentMethodEWallet} {
		if !validMethod.IsValid() {
			t.Errorf("%s should be valid", validMethod)
		}
	}
	for _, invalidMethod := range []PaymentMethod{"", "cash", "CARD", "crypto"} {
		if invalidMethod.IsValid() {
			t.Errorf("%q should be invalid", invalidMethod)
		}
	}
}
