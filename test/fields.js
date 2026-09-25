// The message fields documented in the README. The tests hold both the live
// stream and the README to this list, so a field cannot change silently.
export const FIELDS = {
  data: ['update_type', 'leaf_cert', 'cert_index', 'cert_link', 'seen', 'source'],
  leaf: ['all_domains', 'extensions', 'fingerprint', 'sha1', 'sha256', 'issuer', 'not_after', 'not_before', 'serial_number', 'signature_algorithm', 'subject', 'is_ca'],
  name: ['C', 'ST', 'L', 'O', 'OU', 'CN', 'emailAddress', 'aggregated'],
};
