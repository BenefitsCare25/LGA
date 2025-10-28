# Email Automation Refactoring Plan

## Overview
The `routes/email-automation.js` file has grown to 2028 lines and should be refactored into a modular structure for better maintainability.

## Current Structure Analysis

### Route Groups Identified

**Master List Management (Lines 158-912)**
- `/master-list/upload` - Upload Excel file
- `/master-list/upload-with-exclusions` - Upload with exclusions
- `/extract-exclusion-domains` - Extract exclusion domains
- `/master-list/data` - Get master list data
- `/master-list/stats` - Get statistics
- `/master-list/lead/:email` - Update individual lead
- `/master-list/due-today` - Get leads due today
- `/master-list/export` - Export master list
- `/master-list/merge-recovery` - Merge recovery data

**Email Sending (Lines 1016-1749)**
- `/send-email/:email` - Send individual email
- `/send-campaign-with-attachments` - Send campaign with attachments
- `/send-campaign` - Send email campaign

**Duplicate Management (Lines 1749-1817)**
- `/test-duplicates` - Test duplicate detection
- `/clear-duplicate-cache` - Clear duplicate cache

**Phone Lookup (Lines 1817-1920)**
- `/find-missing-phones` - Find missing phone numbers
- `/find-phones-for-leads` - Find phones for specific leads

## Proposed Modular Structure

```
routes/
├── email-automation/
│   ├── index.js                    # Main router that combines all sub-routes
│   ├── master-list.js              # Master list CRUD operations
│   ├── email-sending.js            # Email sending logic
│   ├── phone-lookup.js             # Phone number lookup operations
│   └── duplicate-management.js     # Duplicate detection/management
└── email-automation.js             # Original file (preserved for reference)
```

## Refactoring Steps

### Phase 1: Preparation (Safe, No Breaking Changes)
- [ ] Create comprehensive test suite for all endpoints
- [ ] Document all route dependencies and shared state
- [ ] Create backup branch before refactoring
- [ ] Set up integration tests

### Phase 2: Extract Shared Utilities
- [ ] Identify shared helper functions
- [ ] Extract to `utils/emailAutomationHelpers.js`
- [ ] Update imports in original file
- [ ] Test functionality

### Phase 3: Create Module Structure
- [ ] Create `routes/email-automation/` directory
- [ ] Create empty module files with exports
- [ ] Create index.js router that combines modules
- [ ] Test that empty structure works

### Phase 4: Incremental Migration
- [ ] **Week 1**: Migrate phone lookup routes (smallest, most isolated)
- [ ] Test phone lookup functionality
- [ ] **Week 2**: Migrate duplicate management routes
- [ ] Test duplicate detection
- [ ] **Week 3**: Migrate master list routes
- [ ] Test file uploads and data operations
- [ ] **Week 4**: Migrate email sending routes
- [ ] Test email campaigns end-to-end

### Phase 5: Validation & Cleanup
- [ ] Run full integration test suite
- [ ] Verify all routes respond correctly
- [ ] Check error handling and edge cases
- [ ] Archive original file to `routes/legacy/`
- [ ] Update documentation

## Risk Mitigation

### Critical Dependencies
- `requireDelegatedAuth` middleware
- `ExcelProcessor` utility
- `EmailSender` utility
- `CampaignLockManager`
- `excelUpdateQueue`

### Testing Requirements
- Unit tests for each extracted module
- Integration tests for route combinations
- Load testing for campaign sending
- Error handling validation

### Rollback Plan
1. Keep original `email-automation.js` as fallback
2. Use feature flag to switch between old/new routes
3. Monitor error rates after each phase
4. Immediate rollback if errors increase >5%

## Benefits of Refactoring

### Maintainability
- Smaller, focused modules (200-400 lines each)
- Clear separation of concerns
- Easier to understand and modify

### Testing
- Isolated unit tests per module
- Faster test execution
- Better code coverage

### Team Collaboration
- Reduced merge conflicts
- Clearer ownership of modules
- Easier onboarding for new developers

## Estimated Effort
- **Phase 1**: 2 days (testing infrastructure)
- **Phase 2**: 1 day (extract utilities)
- **Phase 3**: 0.5 days (create structure)
- **Phase 4**: 4 days (migration, 1 day per module)
- **Phase 5**: 1 day (validation)

**Total**: ~8.5 days of development work

## Success Criteria
- ✅ All existing routes continue to function identically
- ✅ Test coverage increases to >80%
- ✅ Each module is <500 lines
- ✅ No performance degradation
- ✅ Error rate remains unchanged
- ✅ Team approves new structure

## Notes
- This refactoring should be done during low-traffic periods
- Deploy to staging environment first
- Monitor production metrics for 1 week after deployment
- Have database backups ready before each phase
