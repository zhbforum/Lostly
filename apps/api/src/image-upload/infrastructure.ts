import { createImageUploadIngress, type ImageUploadIngress } from './ingress';
import {
  createImageProcessingAdmission,
  type ImageProcessingAdmission,
} from './processing-admission';

export interface ImageUploadInfrastructure {
  ingress: ImageUploadIngress;
  processing: ImageProcessingAdmission;
}

export function createImageUploadInfrastructure(): ImageUploadInfrastructure {
  return {
    ingress: createImageUploadIngress(),
    processing: createImageProcessingAdmission(),
  };
}
