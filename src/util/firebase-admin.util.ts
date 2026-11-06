import * as admin from 'firebase-admin';

/**
 * The Admin app of this codebase: the default credentials of the deployed function, or the
 * emulator's when the functions emulator runs it.
 *
 * @example
 * const firestore = getFirebaseAdminApp().firestore();
 */
export const getFirebaseAdminApp = (): admin.app.App => {
	try {
		return admin.app();
	} catch {
		return admin.initializeApp();
	}
};
