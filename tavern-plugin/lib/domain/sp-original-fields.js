// Original SP message persistence contracts; never include arbitrary plugin fields.
export const originalSpTableFields=Object.freeze(['TavernDB_ACU_IsolatedData','TavernDB_ACU_IndependentData','TavernDB_ACU_Data','TavernDB_ACU_SummaryData','TavernDB_ACU_Identity','TavernDB_ACU_LocalMessageAnchor','TavernDB_ACU_ModifiedKeys','TavernDB_ACU_UpdateGroupKeys','_acu_local_template_base_state_seeded']);
export const originalSp129MaterialFields=Object.freeze(['_qrf_continuation_agent','_qrf_world_simulation_state','_qrf_world_simulation_agent_materials','_qrf_world_simulation_chronicle_archive']);
export const originalSp129CarrierFields=Object.freeze(['_acu_zero_layer_v1']);
export const originalSp129RecoveryFields=Object.freeze([...originalSpTableFields,...originalSp129CarrierFields,...originalSp129MaterialFields]);
