package authz

import "fmt"

func errInvalidPermission(value string) error {
	return fmt.Errorf("invalid daemon permission: %q", value)
}
