// System and Admin level tables.
export const UserTableName = "User";
export const SystemDefinitionTableName = "SystemDefinition";
export const IssueTableName = "Issue";
export const IssueNoteTableName = "IssueNote";
export const AccessRequestTableName = "AccessRequest";
export const ApiKeyTableName = "ApiKey";
export const SynchronizationMarkerTableName = "SynchronizationMarker";
export const ServiceHistoryTableName = "ServiceHistory";
export const SystemErrorTableName = "SystemError";

// Entities with generally fixed contents
export const AtlasKindTableName = "AtlasKind";
export const AtlasTableName = "Atlas";
export const AtlasStructureTableName = "AtlasStructure";
export const NodeStructureTableName = "NodeStructure";
export const NeuronStructureTableName = "NeuronStructure";

// Data sources and top-level entities
export const CollectionTableName = "Collection";
export const GenotypeTableName = "Genotype";
export const FluorophoreTableName = "Fluorophore";
export const InjectionVirusTableName = "InjectionVirus";
export const InjectionTableName = "Injection";
export const SpecimenTableName = "Specimen";
export const NeuronTableName = "Neuron";

// Reconstruction and derived entities
// The table before it was split into Annotation and SpecimenSpaceReconstruction; only migrations use it.
export const ReconstructionTableName = "Reconstruction";
export const AnnotationTableName = "Annotation";
export const SpecimenSpaceReconstructionTableName = "SpecimenSpaceReconstruction";
export const SpecimenNodeTableName = "SpecimenNode";
export const AtlasNodeTableName = "AtlasNode";
export const AtlasReconstructionTableName = "AtlasReconstruction";
export const QualityControlTableName = "QualityControl";
export const SpecimenSpacePrecomputedTableName ="SpecimenSpacePrecomputed";
export const RawReconstructionTableName = "RawReconstruction";
export const RawReconstructionNodeTableName = "RawReconstructionNode";
export const RawReconstructionUploadTableName = "RawReconstructionUpload";
export const PrecomputedTableName = "Precomputed";

// Search infrastructure
export const SearchIndexTableName = "SearchIndex";

// Logging, events, auditing
export const EventLogItemTableName = "EventLogItem";
