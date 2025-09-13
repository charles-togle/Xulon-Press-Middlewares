# Contact and Opportunity Fields Similarities

## Custom Fields
- contact_custom_fields.publisher = opportunity_custom_fields.publisher
- contact_custom_fields.timezone_c = opportunity_custom_fields.timezone
- contact_custom_fields.active_campaigns_c = opportunity_custom_fields.active_or_past_author
- contact_custom_fields.contact_source_detail = opportunity_custom_fields.source_detail_value
- contact_custom_fields.source_detail_value_c = opportunity_custom_fields.source_detail_value

## Default Fields
- contact_default.firstName = opportunity_default.name (when using contact's name)
- contact_default.locationId = opportunity_default.locationId
- contact_default.country = opportunity_default.country
- contact_default.source = opportunity_default.source
- contact_default.assignedTo = opportunity_default.assignedTo

## Notes
- Some custom fields may have different keys but similar meanings (e.g., timezone_c vs timezone).
- Default fields like locationId, country, and source are present in both contact and opportunity payloads.
